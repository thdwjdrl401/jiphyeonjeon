import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { demoSession, getDemoLiveSession } from '@/features/demo/demoData'
import { isLiveEntryOpen } from '@/features/live-session/liveEntry'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

const AUTO_CHECK_ORDER = ['speaker', 'autoplay', 'network'] as const
const AUTO_CHECK_STEP_MS = 350
const NICKNAME_SAVE_DEBOUNCE_MS = 500

export default function StudentPrejoinPage() {
  const { sessionId = demoSession.sessionId } = useParams()
  const session = getDemoLiveSession(sessionId)
  const { user, updateDisplayName } = useAuth()
  const [checks, setChecks] = useState({ speaker: false, autoplay: false, network: false, consent: false })
  const [nickname, setNickname] = useState(user?.displayName ?? '')
  const ready = Object.values(checks).every(Boolean)
  usePageTitle('입장 전 점검')

  // 재생 환경 점검은 사용자가 누르지 않아도 마법사가 순서대로 자동 통과시킨다.
  useEffect(() => {
    const timers = AUTO_CHECK_ORDER.map((key, index) =>
      window.setTimeout(() => setChecks((current) => ({ ...current, [key]: true })), (index + 1) * AUTO_CHECK_STEP_MS),
    )
    return () => timers.forEach((timer) => window.clearTimeout(timer))
  }, [])

  useEffect(() => setNickname(user?.displayName ?? ''), [user?.displayName])

  // 닉네임을 수정하면 디바운스 후 즉시 반영(현재는 목 계정 서비스; 실제 API는 없음).
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

  if (!isLiveEntryOpen(session)) {
    return <PageState title="강의 시간이 아닙니다" description="라이브 강의는 시작 10분 전부터 입장할 수 있어요." action={<Link className="button button--soft" to={studentPaths.lesson(session.curriculumId, session.sectionId, session.lessonId)}>강의 상세로 돌아가기</Link>} />
  }
  return <div className="workspace-page workspace-page--narrow"><PageHeader title="입장 전 점검" description={<>{session.lessonTitle}<br />수강생에게 카메라와 마이크 권한을 요청하지 않습니다.</>} action={<StatusBadge tone="live">{session.status}</StatusBadge>} />
    <Panel title="재생 환경 확인" description="마법사가 재생 환경을 자동으로 확인하고 있어요."><div className="precheck-list"><button className={checks.speaker ? 'is-pass' : ''} type="button" disabled><span>{checks.speaker ? '✓' : '1'}</span><div><strong>스피커 테스트</strong><small>테스트 소리가 선명하게 들립니다.</small></div><b>{checks.speaker ? '완료' : '확인 중'}</b></button><button className={checks.autoplay ? 'is-pass' : ''} type="button" disabled><span>{checks.autoplay ? '✓' : '2'}</span><div><strong>자동 재생 확인</strong><small>브라우저에서 영상과 음성 재생을 허용합니다.</small></div><b>{checks.autoplay ? '완료' : '확인 중'}</b></button><button className={checks.network ? 'is-pass' : ''} type="button" disabled><span>{checks.network ? '✓' : '3'}</span><div><strong>네트워크 상태</strong><small>현재 연결은 라이브 수신에 안정적입니다.</small></div><b>{checks.network ? '양호' : '확인 중'}</b></button></div></Panel>
    <Panel title="닉네임과 녹화 고지"><dl className="identity-list"><div><dt>닉네임</dt><dd><input className="identity-nickname-input" value={nickname} maxLength={100} onChange={(event) => setNickname(event.target.value)} /></dd></div><div><dt>미디어 권한</dt><dd>수신 전용</dd></div></dl><label className="choice-row"><input type="checkbox" checked={checks.consent} onChange={toggleConsent} /><span><strong>녹화·자막·채팅·AI 사용 안내를 확인했습니다.</strong><small>개인 AI 질문 기록은 본인에게만 표시되고 익명 통계에 반영될 수 있습니다.</small></span></label></Panel>
    {!ready && <InlineNotice tone="warning">모든 필수 점검과 고지를 확인해야 입장할 수 있습니다.</InlineNotice>}
    <div className="sticky-form-actions"><Link className="button button--ghost" to={studentPaths.lesson(session.curriculumId, session.sectionId, session.lessonId)}>강의 상세</Link>{ready ? <Link className="button button--primary button--large" state={{ prejoinSessionId: sessionId }} to={studentPaths.classroom(sessionId)}>라이브 입장</Link> : <button className="button button--primary button--large is-disabled" type="button" disabled>라이브 입장</button>}</div>
  </div>
}
