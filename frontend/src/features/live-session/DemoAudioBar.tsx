import { useRef, type ChangeEvent } from 'react'
import { useAuth } from '@/features/auth/AuthContext'
import { useInstructorLiveKit } from './useInstructorLiveKit'

/**
 * 시연용 음성 파일 재생기(ADR-0103).
 *
 * <p><b>고르는 것과 트는 것이 다르다.</b> 파일을 골라 두어도 마이크는 진짜 마이크 그대로다.
 * 재생을 눌러야 그때 마이크 자리가 파일로 바뀐다 — 강의에 들어가자마자 소리가 나가면 인사도 못 한다.
 *
 * <p><b>재생 중이라는 사실을 계속 말한다.</b> 화면은 평소와 완전히 같아서, 말해 주지 않으면 진짜
 * 수업에 켜 둔 채로 들어간 것을 알아챌 방법이 없다(같은 이유로 DemoPublishBanner가 있다).
 *
 * <p>`isAdmin`은 가입 역할이 아니라 서버 allowlist 오버레이다. 이 화면 자체가 소유 강사 전용이므로
 * 여기서 더 볼 것은 "시연을 하는 사람인가" 하나다.
 */
export default function DemoAudioBar() {
  const { user } = useAuth()
  const {
    demoAudio,
    selectDemoAudioFile,
    clearDemoAudioFile,
    startDemoAudio,
    stopDemoAudio,
    pauseDemoAudio,
    resumeDemoAudio,
    seekDemoAudio,
    setDemoAudioLoop,
    microphoneEnabled,
    toggleMicrophone,
  } = useInstructorLiveKit()
  const inputRef = useRef<HTMLInputElement>(null)

  if (!user?.isAdmin) return null

  const pick = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (file) selectDemoAudioFile(file)
    // 같은 파일을 다시 고를 수 있어야 한다 — 값을 비우지 않으면 change가 안 난다.
    event.target.value = ''
  }

  return (
    <div className={`demo-audio-bar${demoAudio.live ? ' is-live' : ''}`}>
      <input
        accept="audio/*"
        aria-label="시연용 음성 파일"
        className="demo-audio-bar__input"
        onChange={pick}
        ref={inputRef}
        type="file"
      />

      {demoAudio.fileName === null ? (
        <button className="demo-audio-bar__btn" type="button" onClick={() => inputRef.current?.click()}>
          🎧 시연 음성 선택
        </button>
      ) : (
        <>
          <span className="demo-audio-bar__name" title={demoAudio.fileName}>{demoAudio.fileName}</span>

          {!demoAudio.live ? (
            <button className="demo-audio-bar__btn demo-audio-bar__btn--go" type="button" onClick={startDemoAudio}>
              ▶ 재생 — 마이크 대신 내보내기
            </button>
          ) : (
            <>
              {demoAudio.playing
                ? <button className="demo-audio-bar__btn" type="button" onClick={pauseDemoAudio}>Ⅱ 일시정지</button>
                : <button className="demo-audio-bar__btn" type="button" onClick={resumeDemoAudio}>▶ 이어서</button>}

              {/*
                구간 이동은 <b>송출 제어</b>다. 뒤로 감으면 STT가 같은 구간을 다시 받아 자막이 겹친다.
                그래도 둔다 — 시연 중 판서가 밀렸을 때 되돌릴 방법이 이것뿐이다.
              */}
              <input
                aria-label="재생 위치"
                className="demo-audio-bar__seek"
                max={Math.max(demoAudio.durationMs, 1)}
                min={0}
                onChange={(event) => seekDemoAudio(Number(event.target.value))}
                type="range"
                value={demoAudio.positionMs}
              />
              <span className="demo-audio-bar__time">
                {formatClock(demoAudio.positionMs)} / {formatClock(demoAudio.durationMs)}
              </span>

              {/*
                나가는 소리를 멎게 한다. <b>일시정지와 다르다</b> — 일시정지는 파일이 멈춰 자리를
                잃지만, 음소거는 계속 흐르면서 소리만 안 나간다. 강사가 잠깐 끼어들 자리다.

                컨트롤 줄의 마이크 버튼은 이 상황에서 잠겨 있다(내 마이크는 이미 꺼져 있다).
                그래서 나가는 소리를 다루는 자리가 여기여야 한다.
              */}
              <button
                aria-pressed={!microphoneEnabled}
                className="demo-audio-bar__btn"
                type="button"
                onClick={toggleMicrophone}
              >
                {microphoneEnabled ? '🔇 음소거' : '🔈 음소거 해제'}
              </button>

              <button className="demo-audio-bar__btn" type="button" onClick={stopDemoAudio}>
                ■ 마이크로 복귀
              </button>
            </>
          )}

          {/* 기본은 꺼짐 — 끝나면 진짜 마이크로 돌아간다. 켜 두면 돌아가지 않고 처음부터 다시 돈다. */}
          <label className="demo-audio-bar__loop">
            <input
              checked={demoAudio.loop}
              onChange={(event) => setDemoAudioLoop(event.target.checked)}
              type="checkbox"
            />
            반복
          </label>

          {!demoAudio.live && (
            <button className="demo-audio-bar__btn demo-audio-bar__btn--quiet" type="button" onClick={clearDemoAudioFile}>해제</button>
          )}
        </>
      )}

      {demoAudio.live && (
        <strong className="demo-audio-bar__flag" role="status">
          시연 음성이 마이크 자리로 나가는 중
        </strong>
      )}
    </div>
  )
}

function formatClock(ms: number) {
  const total = Math.floor(ms / 1000)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
