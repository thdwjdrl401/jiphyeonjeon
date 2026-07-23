import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { isLiveEntryOpen } from '@/features/live-session/liveEntry'
import { getLiveSession, getLiveToken } from '@/features/live-session/liveSessionService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

// 자동 점검은 브라우저가 스스로 확인하는 항목만 담는다. 스피커는 사용자가 직접 확인한다.
const AUTO_CHECK_ORDER = ['autoplay', 'network'] as const
const AUTO_CHECK_STEP_MS = 350
const NICKNAME_SAVE_DEBOUNCE_MS = 500
const TEST_TONE_MS = 950

type SpeakerStage = 'idle' | 'testing' | 'confirm'

// 스피커 테스트용 짧은 음을 Web Audio로 직접 생성해 재생한다(외부 오디오 자산 불필요).
function playTestTone() {
  const AudioCtx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!AudioCtx) return
  const ctx = new AudioCtx()
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  const now = ctx.currentTime
  oscillator.type = 'sine'
  oscillator.frequency.value = 523.25
  gain.gain.setValueAtTime(0.0001, now)
  gain.gain.exponentialRampToValueAtTime(0.18, now + 0.04)
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(now)
  oscillator.stop(now + 0.95)
  oscillator.onended = () => { void ctx.close() }
}

export default function StudentPrejoinPage() {
  const { sessionId = '' } = useParams()
  const navigate = useNavigate()
  const sessionQuery = useQuery({ queryKey: ['live-session', sessionId], queryFn: () => getLiveSession(sessionId), enabled: Boolean(sessionId) })
  const tokenMutation = useMutation({
    mutationFn: () => getLiveToken(sessionId),
    onSuccess: (connection) => navigate(studentPaths.classroom(sessionId), { state: { prejoinSessionId: sessionId, connection } }),
  })
  const session = sessionQuery.data
  const { user, updateDisplayName } = useAuth()
  const [checks, setChecks] = useState({ speaker: false, autoplay: false, network: false, consent: false })
  const [speakerStage, setSpeakerStage] = useState<SpeakerStage>('idle')
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

  const toggleConsent = () => setChecks((current) => ({ ...current, consent: !current.consent }))

  // 스피커 테스트: 사용자가 버튼을 눌러 테스트 음을 재생한 뒤 직접 결과를 확인한다.
  const runSpeakerTest = () => {
    setSpeakerStage('testing')
    playTestTone()
    window.setTimeout(() => setSpeakerStage('confirm'), TEST_TONE_MS)
  }
  const confirmSpeaker = () => setChecks((current) => ({ ...current, speaker: true }))

  if (!sessionId) return <PageState title="잘못된 라이브 세션 경로입니다" />
  if (sessionQuery.isPending) return <PageState title="라이브 세션을 불러오는 중입니다" />
  if (sessionQuery.isError || !session) return <PageState title="라이브 세션을 불러오지 못했습니다" />

  if (!isLiveEntryOpen(session)) {
    return <PageState title="강의 시간이 아닙니다" description="라이브 강의는 시작 10분 전부터 입장할 수 있어요." action={<Link className="button button--soft" to={studentPaths.lesson(session.curriculumId, session.sectionId, session.lessonId)}>강의 상세로 돌아가기</Link>} />
  }
  return <div className="workspace-page workspace-page--narrow"><PageHeader title="입장 전 점검" description={<>{session.lessonTitle}<br />수강생에게 카메라와 마이크 권한을 요청하지 않습니다.</>} action={<StatusBadge tone="live">{session.status}</StatusBadge>} />
    <Panel title="자동 점검" description="브라우저가 자동으로 확인하는 항목이에요. 따로 조작하지 않아도 됩니다." action={<StatusBadge tone={autoDone ? 'success' : 'neutral'}>{autoDone ? '완료' : '확인 중'}</StatusBadge>}>
      <div className="precheck-list">
        <button className={checks.autoplay ? 'is-pass' : ''} type="button" disabled><span>{checks.autoplay ? '✓' : '1'}</span><div><strong>자동 재생 확인</strong><small>브라우저에서 영상과 음성 재생을 허용합니다.</small></div><b>{checks.autoplay ? '완료' : '확인 중'}</b></button>
        <button className={checks.network ? 'is-pass' : ''} type="button" disabled><span>{checks.network ? '✓' : '2'}</span><div><strong>네트워크 상태</strong><small>현재 연결은 라이브 수신에 안정적입니다.</small></div><b>{checks.network ? '양호' : '확인 중'}</b></button>
      </div>
    </Panel>
    <Panel title="직접 확인" description="테스트 음성을 직접 듣고 확인해 주세요. 이 항목만 완료하면 입장할 수 있어요." action={<StatusBadge tone={checks.speaker ? 'success' : 'warning'}>{checks.speaker ? '완료' : '확인 필요'}</StatusBadge>}>
      <div className={`speaker-check${checks.speaker ? ' is-pass' : ''}`}>
        <div className="speaker-check__row">
          <span>{checks.speaker ? '✓' : '♪'}</span>
          <div><strong>스피커 테스트</strong><small>테스트 음성을 재생하고 소리가 잘 들리는지 확인하세요.</small></div>
          <b>{checks.speaker ? '완료' : speakerStage === 'testing' ? '재생 중' : '확인 필요'}</b>
        </div>
        {!checks.speaker && speakerStage === 'idle' && <button className="button button--soft button--small" type="button" onClick={runSpeakerTest}>▶ 테스트 시작</button>}
        {!checks.speaker && speakerStage === 'testing' && <button className="button button--soft button--small" type="button" disabled>테스트 음성 재생 중…</button>}
        {!checks.speaker && speakerStage === 'confirm' && (
          <div className="speaker-confirm" role="group" aria-label="스피커 테스트 결과 확인">
            <p>테스트 음성이 잘 들렸나요?</p>
            <div><button className="button button--ghost button--small" type="button" onClick={runSpeakerTest}>다시 듣기</button><button className="button button--primary button--small" type="button" onClick={confirmSpeaker}>네, 잘 들려요</button></div>
          </div>
        )}
      </div>
    </Panel>
    <Panel title="닉네임과 녹화 고지"><dl className="identity-list"><div><dt>닉네임</dt><dd><input className="identity-nickname-input" value={nickname} maxLength={100} onChange={(event) => setNickname(event.target.value)} /></dd></div><div><dt>미디어 권한</dt><dd>수신 전용</dd></div></dl><label className="choice-row"><input type="checkbox" checked={checks.consent} onChange={toggleConsent} /><span><strong>녹화·자막·채팅·AI 사용 안내를 확인했습니다.</strong><small>개인 AI 질문 기록은 본인에게만 표시되고 익명 통계에 반영될 수 있습니다.</small></span></label></Panel>
    {!ready && <InlineNotice tone="warning">모든 필수 점검과 고지를 확인해야 입장할 수 있습니다.</InlineNotice>}
    {tokenMutation.isError && <InlineNotice tone="danger">라이브 입장 토큰 발급에 실패했습니다.</InlineNotice>}
    <div className="sticky-form-actions"><Link className="button button--ghost" to={studentPaths.lesson(session.curriculumId, session.sectionId, session.lessonId)}>강의 상세</Link>{ready ? <Link className="button button--primary button--large" to={studentPaths.classroom(sessionId)} onClick={(event) => { event.preventDefault(); tokenMutation.mutate() }}>라이브 입장</Link> : <button className="button button--primary button--large is-disabled" type="button" disabled>라이브 입장</button>}</div>
  </div>
}
