import { useRef } from 'react'
import { useAuth } from '@/features/auth/AuthContext'
import DemoTransport from './DemoTransport'
import { useInstructorLiveKit } from './useInstructorLiveKit'

/**
 * 시연용 파일 송출 스위치(ADR-0100). <b>운영 계정에게만</b> 보인다.
 *
 * <p>`isAdmin`은 가입 역할이 아니라 서버 allowlist 오버레이라, 이 화면 자체는 <b>소유 강사</b>만
 * 열 수 있다. 즉 여기 버튼이 보이는 사람은 "이 강의의 강사이면서 운영 계정"인 경우뿐이다.
 *
 * <p><b>배지를 숨기지 않는다.</b> 데모로 송출 중이라는 사실이 화면에 계속 떠 있어야 진짜 수업에
 * 켜 둔 채로 들어가는 일이 없다.
 */
export default function DemoPublishControl() {
  const { user } = useAuth()
  const publisher = useInstructorLiveKit()
  const inputRef = useRef<HTMLInputElement>(null)
  // 운영 계정 판정을 먼저 한다 — 아닌 사람에게는 이 아래가 통째로 없는 것과 같아야 한다.
  if (!user?.isAdmin) return null

  const { armed, ready, fileName, hasAudio } = publisher.demoPublish

  return (
    <div className={`demo-publish${armed ? ' is-armed' : ''}`}>
      <input
        accept="video/mp4,video/*"
        className="visually-hidden"
        onChange={(event) => {
          const file = event.target.files?.[0]
          // 같은 파일을 다시 고를 수 있어야 한다 — 값을 비우지 않으면 change가 안 난다.
          event.target.value = ''
          if (file) publisher.startDemoPublish(file)
        }}
        ref={inputRef}
        type="file"
      />
      <div className="demo-publish__text">
        <strong>{armed ? '데모 송출 중' : '데모 송출'}</strong>
        <small>
          {armed
            ? ready
              ? hasAudio
                ? `${fileName} — 카메라·마이크 대신 이 영상이 나갑니다.`
                // 소리가 없으면 조용히 실패한다. 자막이 없으면 노트도 AI도 빈 채로 간다.
                : `${fileName} — 소리가 없는 파일입니다. 자막·강의 노트·AI 답변이 만들어지지 않습니다.`
              : '새로고침으로 파일이 사라졌습니다. 카메라로 자동 전환하지 않았습니다.'
            : '카메라 대신 미리 녹화한 mp4를 송출합니다. 자막·녹화·AI는 평소대로 동작합니다.'}
        </small>
      </div>
      {/* 시작 전에 원하는 지점으로 맞춰 두고 들어갈 수 있어야 한다. */}
      <DemoTransport />
      <div className="demo-publish__actions">
        <button
          className="button button--soft button--small"
          disabled={publisher.pendingControl !== null}
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          {armed ? '영상 바꾸기' : '데모 영상 선택'}
        </button>
        {armed && (
          <button
            className="button button--soft button--small"
            disabled={publisher.pendingControl !== null}
            onClick={() => publisher.stopDemoPublish()}
            type="button"
          >
            데모 끄기
          </button>
        )}
      </div>
    </div>
  )
}
