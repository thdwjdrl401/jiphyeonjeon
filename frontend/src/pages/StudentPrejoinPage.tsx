import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { isLiveEntryOpen } from '@/features/live-session/liveEntry'
import { getLiveSession } from '@/features/live-session/liveSessionService'
import {
  playSpeakerTest,
  prefetchSpeakerTestChime,
  SPEAKER_TEST_CHANNEL_LABEL,
  SPEAKER_TEST_STEPS,
  type SpeakerTestChannel,
} from '@/features/live-session/speakerTest'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

// 자동 점검은 브라우저가 스스로 확인하는 항목만 담는다. 스피커는 사용자가 직접 확인한다.
const AUTO_CHECK_ORDER = ['autoplay', 'network'] as const
const AUTO_CHECK_STEP_MS = 350
const NICKNAME_SAVE_DEBOUNCE_MS = 500

type SpeakerStage = 'idle' | 'testing' | 'confirm'

export default function StudentPrejoinPage() {
  const { sessionId = '' } = useParams()
  const sessionQuery = useQuery({ queryKey: ['live-session', sessionId], queryFn: () => getLiveSession(sessionId), enabled: Boolean(sessionId) })
  const session = sessionQuery.data
  const { user, updateDisplayName } = useAuth()
  const [checks, setChecks] = useState({ speaker: false, autoplay: false, network: false })
  const [speakerStage, setSpeakerStage] = useState<SpeakerStage>('idle')
  const [testChannel, setTestChannel] = useState<SpeakerTestChannel | null>(null)
  const stopSpeakerTestRef = useRef<(() => void) | null>(null)
  const [nickname, setNickname] = useState(user?.displayName ?? '')
  const ready = Object.values(checks).every(Boolean)
  const autoDone = checks.autoplay && checks.network
  usePageTitle('입장 전 점검')

  // 재생 환경 점검은 사용자가 누르지 않아도 마법사가 순서대로 자동 통과시킨다.
  useEffect(() => {
    const timers = AUTO_CHECK_ORDER.map((key, index) =>
      window.setTimeout(() => setChecks((current) => ({ ...current, [key]: true })), (index + 1) * AUTO_CHECK_STEP_MS),
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [])

  useEffect(() => setNickname(user?.displayName ?? ''), [user?.displayName])

  // 재생 중에 화면을 떠나면 소리가 남는다 — 입장 버튼을 눌러 강의실로 넘어가는 게 정상 흐름이라
  // 실제로 자주 일어난다.
  useEffect(() => () => stopSpeakerTestRef.current?.(), [])

  // 테스트음을 미리 받아 둔다. 버튼을 누른 뒤 내려받기 시작하면 느린 회선에서 "재생 중"인데
  // 소리가 안 나는 구간이 생긴다.
  useEffect(() => { prefetchSpeakerTestChime() }, [])

  // 닉네임을 수정하면 디바운스 후 선택된 인증 서비스 구현체에 즉시 반영한다.
  useEffect(() => {
    const trimmed = nickname.trim()
    if (!trimmed || trimmed === user?.displayName) return
    const timer = window.setTimeout(() => {
      updateDisplayName(trimmed).catch(() => {})
    }, NICKNAME_SAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nickname])

  // 스피커 테스트: 좌 → 우 → 양쪽 3초 테스트음을 듣고 사용자가 직접 결과를 확인한다.
  // 재생 중인 채널을 화면에도 같이 표시해야 "지금 왼쪽인데 안 들린다"를 학생이 알 수 있다.
  const runSpeakerTest = () => {
    stopSpeakerTestRef.current?.()   // 다시 듣기 — 겹쳐 울리면 좌우 판단이 불가능해진다.
    setSpeakerStage('testing')
    setTestChannel(null)
    stopSpeakerTestRef.current = playSpeakerTest({
      onStep: setTestChannel,
      onEnd: () => {
        setTestChannel(null)
        setSpeakerStage('confirm')
      },
    })
  }
  const confirmSpeaker = () => setChecks((current) => ({ ...current, speaker: true }))

  if (!sessionId) return <PageState title="잘못된 라이브 세션 경로입니다" />
  if (sessionQuery.isPending) return <PageState title="라이브 세션을 불러오는 중입니다" />
  if (sessionQuery.isError || !session) return <PageState title="라이브 세션을 불러오지 못했습니다" />

  if (!isLiveEntryOpen(session)) {
    return <PageState title="강의 시간이 아닙니다" description="라이브 강의는 시작 10분 전부터 입장할 수 있어요." action={<Link className="button button--soft" to={studentPaths.lesson(session.curriculumId, session.sectionId, session.lessonId)}>강의 상세로 돌아가기</Link>} />
  }
  return (
    <div className="workspace-page student-prejoin-page">
      <PageHeader title="입장 전 점검" />

      <div className="student-prejoin__layout">
        <Panel
          className="student-prejoin__speaker-panel"
          title="스피커 직접 점검"
          description="테스트음을 듣고 좌우 채널이 모두 정상인지 확인해 주세요."
          action={<StatusBadge tone={checks.speaker ? 'success' : 'warning'}>{checks.speaker ? '완료' : '확인 필요'}</StatusBadge>}
        >
          <div className={`speaker-check${checks.speaker ? ' is-pass' : ''}`}>
            <div className="speaker-check__row">
              <span>{checks.speaker ? '✓' : '♪'}</span>
              <div>
                <strong>스피커 테스트</strong>
                <small>왼쪽 → 오른쪽 → 양쪽 순서로 소리가 납니다.</small>
              </div>
              <b>{checks.speaker ? '완료' : speakerStage === 'testing' ? '재생 중' : '확인 필요'}</b>
            </div>
            {!checks.speaker && (
              // 소리와 같은 순서로 켜지는 표시. 지금 어느 채널이 울리는지 눈으로 확인할 수 있어야
              // "왼쪽에서 안 들렸다"처럼 학생이 스스로 원인을 짚을 수 있다.
              <ol className="speaker-channels" aria-label="테스트음 재생 위치">
                {SPEAKER_TEST_STEPS.map((step) => (
                  <li
                    key={step.channel}
                    className={testChannel === step.channel ? 'is-active' : undefined}
                    aria-current={testChannel === step.channel ? 'step' : undefined}
                  >
                    {SPEAKER_TEST_CHANNEL_LABEL[step.channel]}
                  </li>
                ))}
              </ol>
            )}
            {!checks.speaker && speakerStage === 'idle' && (
              <button className="button button--soft button--small" type="button" onClick={runSpeakerTest}>▶ 테스트 시작</button>
            )}
            {!checks.speaker && speakerStage === 'testing' && (
              <button className="button button--soft button--small" type="button" disabled>
                {testChannel ? `${SPEAKER_TEST_CHANNEL_LABEL[testChannel]} 재생 중…` : '테스트 음성 재생 중…'}
              </button>
            )}
            {!checks.speaker && speakerStage === 'confirm' && (
              <div className="speaker-confirm" role="group" aria-label="스피커 테스트 결과 확인">
                <p>왼쪽과 오른쪽에서 모두 잘 들렸나요?</p>
                <div>
                  <button className="button button--ghost button--small" type="button" onClick={runSpeakerTest}>다시 듣기</button>
                  <button className="button button--primary button--small" type="button" onClick={confirmSpeaker}>네, 모두 들려요</button>
                </div>
              </div>
            )}
          </div>
        </Panel>

        <Panel
          className="student-prejoin__info-panel"
          title="입장 정보"
          description="표시 이름과 재생 환경을 확인합니다."
          action={<StatusBadge tone={autoDone ? 'success' : 'neutral'}>{autoDone ? '자동 점검 완료' : '확인 중'}</StatusBadge>}
        >
          <dl className="identity-list student-prejoin__identity-list">
            <div>
              <dt>닉네임</dt>
              <dd>
                <input
                  aria-label="입장 닉네임"
                  className="identity-nickname-input"
                  value={nickname}
                  maxLength={100}
                  onChange={(event) => setNickname(event.target.value)}
                />
              </dd>
            </div>
            <div>
              <dt>미디어 권한</dt>
              <dd>HLS 재생 전용<small>카메라·마이크 권한 미사용</small></dd>
            </div>
          </dl>

          <div className="student-prejoin__auto-checks">
            <div className="student-prejoin__auto-heading">
              <strong>자동 점검</strong>
              <small>브라우저가 자동으로 확인합니다.</small>
            </div>
            <ul aria-label="자동 점검 상태">
              <li className={checks.autoplay ? 'is-pass' : undefined}>
                <span>{checks.autoplay ? '✓' : '1'}</span>
                <div><strong>자동 재생</strong><small>영상·음성 재생 허용</small></div>
                <b>{checks.autoplay ? '완료' : '확인 중'}</b>
              </li>
              <li className={checks.network ? 'is-pass' : undefined}>
                <span>{checks.network ? '✓' : '2'}</span>
                <div><strong>네트워크</strong><small>라이브 수신 연결</small></div>
                <b>{checks.network ? '양호' : '확인 중'}</b>
              </li>
            </ul>
          </div>
        </Panel>
      </div>

      <div className="sticky-form-actions student-prejoin__actions">
        <Link className="button button--ghost" to={studentPaths.lesson(session.curriculumId, session.sectionId, session.lessonId)}>강의 상세</Link>
        <div className="student-prejoin__entry-state" role="status" aria-live="polite">
          <strong>{ready ? '입장 준비 완료' : autoDone ? '스피커 확인 필요' : '자동 점검 중'}</strong>
          <small>
            {ready
              ? '모든 필수 점검을 완료했습니다.'
              : autoDone
                ? '테스트음을 확인하면 입장할 수 있습니다.'
                : '재생 환경을 확인하고 있습니다.'}
          </small>
        </div>
        {ready ? (
          <Link className="button button--primary button--large" state={{ prejoinSessionId: sessionId }} to={studentPaths.classroom(sessionId)}>라이브 입장</Link>
        ) : (
          <button className="button button--primary button--large is-disabled" type="button" disabled>라이브 입장</button>
        )}
      </div>
    </div>
  )
}
