import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { publicPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import LessonBreadcrumbs from '@/features/lesson/LessonBreadcrumbs'
import { isLiveEntryOpen } from '@/features/live-session/liveEntry'
import { isPrestartStatus } from '@/features/live-session/livePrestart'
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

/**
 * 입장 클릭의 결과. `closed`·`error`가 팝업을 띄운다.
 *
 * <p><b>시작 전은 막지 않는다</b>(ADR-0084). 예전에는 여기서 "강의가 아직 시작되지 않았습니다" 팝업을
 * 띄우고 돌려보냈는데, 그러면 학생은 강사가 시작할 때까지 이 버튼을 반복해서 눌러야 한다 — 예정 시각과
 * 실제 시작 시각은 늘 어긋나므로 그 반복이 기본 동선이 된다. 지금은 들여보내고 <b>강의실 안에서</b>
 * 기다리게 하며, 시작 신호(`session.started`)를 받으면 화면이 스스로 재생으로 넘어간다.
 *
 * <p>`closed`는 남는다. 끝났거나 취소된 강의는 <b>기다려도 열리지 않아</b> 성격이 다르다.
 */
type EntryStatus = 'idle' | 'checking' | 'closed' | 'error'

export default function StudentPrejoinPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const sessionQuery = useQuery({ queryKey: ['live-session', sessionId], queryFn: () => getLiveSession(sessionId), enabled: Boolean(sessionId) })
  const session = sessionQuery.data
  const { user, updateDisplayName } = useAuth()
  const [checks, setChecks] = useState({ speaker: false, autoplay: false, network: false })
  const [speakerStage, setSpeakerStage] = useState<SpeakerStage>('idle')
  const [testChannel, setTestChannel] = useState<SpeakerTestChannel | null>(null)
  const stopSpeakerTestRef = useRef<(() => void) | null>(null)
  const [nickname, setNickname] = useState(user?.displayName ?? '')
  const [entryStatus, setEntryStatus] = useState<EntryStatus>('idle')
  const entryButtonRef = useRef<HTMLButtonElement | null>(null)
  const entryDialogRef = useRef<HTMLElement | null>(null)
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

  const isEntryDialogOpen = entryStatus === 'closed' || entryStatus === 'error'
  const closeEntryDialog = () => {
    setEntryStatus('idle')
    // 팝업을 닫으면 방금 누른 입장 버튼으로 초점을 돌려준다 — 다시 시도하는 자리가 거기다.
    entryButtonRef.current?.focus()
  }

  /*
   * 열리면 팝업 안으로 초점을 넣고 Escape로 닫는다. 이 팝업은 화면 전체를 덮으므로(aria-modal),
   * 초점을 옮기지 않으면 스크린리더는 뒤쪽 점검 목록을 계속 읽고 키보드 사용자는 보이지 않는
   * 버튼들 사이를 돌게 된다.
   */
  useEffect(() => {
    if (!isEntryDialogOpen) return

    entryDialogRef.current?.focus()
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setEntryStatus('idle')
      entryButtonRef.current?.focus()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isEntryDialogOpen])

  const enterLiveClassroom = async () => {
    setEntryStatus('checking')
    try {
      // 점검 화면을 연 뒤에 강사가 시작했을 수 있으므로 입장 순간의 최신 상태를 다시 본다.
      // 초기 쿼리 캐시만 믿으면 SCHEDULED 상태가 남아 있거나, 반대로 종료된 강의에
      // 들어갈 수 있다.
      const latestSession = await getLiveSession(sessionId)

      /*
       * <b>시작 전은 통과시킨다</b> — 강의실이 대기 상태를 그리고 시작 신호로 스스로 넘어간다(ADR-0084).
       * 막는 것은 <b>기다려도 열리지 않는</b> 상태(ENDED·CANCELLED·FAILED)뿐이다.
       *
       * <p>막힌 상태는 공유 캐시에 쓰지 않는다. 여기 쓰면 이 화면 위쪽의 입장 게이트
       * (`isLiveEntryOpen`)가 곧바로 화면 전체를 "강의 시간이 아닙니다"로 갈아치워, 방금 띄운
       * 팝업과 설명이 사라진다. 게이트는 <b>화면에 들어올 때</b> 판정하는 장치이고, 머무는
       * 동안의 변화는 이 팝업이 설명한다.
       */
      if (latestSession.status !== 'LIVE' && !isPrestartStatus(latestSession.status)) {
        setEntryStatus('closed')
        return
      }

      // 들어갈 때는 최신 상태를 넘겨 준다 — 강의실이 같은 키를 읽는다.
      queryClient.setQueryData(['live-session', sessionId], latestSession)
      navigate(studentPaths.classroom(sessionId), { state: { prejoinSessionId: sessionId } })
    } catch {
      setEntryStatus('error')
    }
  }

  if (!sessionId) return <PageState title="잘못된 라이브 세션 경로입니다" />
  if (sessionQuery.isPending) return <PageState title="라이브 세션을 불러오는 중입니다" />
  if (sessionQuery.isError || !session) return <PageState title="라이브 세션을 불러오지 못했습니다" />

  if (!isLiveEntryOpen(session)) {
    return <PageState title="강의 시간이 아닙니다" description="라이브 강의는 시작 10분 전부터 입장할 수 있어요." action={<Link className="button button--soft" to={studentPaths.lesson(session.curriculumId, session.sectionId, session.lessonId)}>강의 상세로 돌아가기</Link>} />
  }
  return (
    <div className="workspace-page student-prejoin-page">
      <LessonBreadcrumbs
        curriculumPath={session.curriculumId ? publicPaths.curriculum(session.curriculumId) : undefined}
        curriculumTitle={session.curriculumTitle}
        lessonPath={session.curriculumId && session.sectionId
          ? studentPaths.lesson(session.curriculumId, session.sectionId, session.lessonId)
          : undefined}
        lessonTitle={session.lessonTitle}
        sectionTitle={session.sectionTitle}
      />
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
          <button
            ref={entryButtonRef}
            className="button button--primary button--large"
            type="button"
            disabled={entryStatus === 'checking'}
            onClick={() => { void enterLiveClassroom() }}
          >
            {entryStatus === 'checking' ? '강의 상태 확인 중…' : '라이브 입장'}
          </button>
        ) : (
          <button className="button button--primary button--large is-disabled" type="button" disabled>라이브 입장</button>
        )}
      </div>

      {isEntryDialogOpen && (
        <div className="live-entry-dialog-backdrop">
          <section
            ref={entryDialogRef}
            className="live-entry-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-entry-dialog-title"
            aria-describedby="live-entry-dialog-description"
            tabIndex={-1}
          >
            <span className="eyebrow">LIVE CLASS</span>
            <h2 id="live-entry-dialog-title">
              {entryStatus === 'closed' ? '입장할 수 없는 강의입니다' : '강의 상태를 확인하지 못했습니다'}
            </h2>
            <p id="live-entry-dialog-description">
              {entryStatus === 'closed'
                ? '이미 종료되었거나 취소된 강의입니다. 다시보기가 공개되면 강의 상세에서 확인할 수 있어요.'
                : '잠시 후 라이브 입장 버튼을 다시 눌러 주세요.'}
            </p>
            <div className="live-entry-dialog__actions">
              <button className="button button--primary" type="button" onClick={closeEntryDialog}>확인</button>
            </div>
          </section>
        </div>
      )}
    </div>
  )
}
