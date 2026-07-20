import { Link, useParams } from 'react-router-dom'
import { instructorPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { demoSession, getDemoLiveSession } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

export default function LiveSessionDetailPage() {
  const { sessionId = demoSession.sessionId } = useParams()
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const session = getDemoLiveSession(sessionId)
  usePageTitle('라이브 세션')
  return <div className="workspace-page"><PageHeader eyebrow="LIVE SESSION" title={session.lessonTitle} description={`${session.curriculumTitle} · ${session.scheduledAt ?? '일정 미정'}`} action={<StatusBadge tone="live">{session.status}</StatusBadge>} />
    <div className="session-detail-grid"><Panel title="라이브 일정"><div className="big-schedule"><div><span>8월</span><strong>01</strong></div><dl><div><dt>시작</dt><dd>오전 10:00</dd></div><div><dt>입장 가능</dt><dd>오전 9:50부터</dd></div><div><dt>예상 시간</dt><dd>90분</dd></div></dl></div></Panel><Panel title="현재 상태"><div className="state-hero"><StatusBadge tone="live">입장 가능</StatusBadge><h3>라이브 시작을 기다리고 있어요</h3><p>{isInstructor ? '사전 점검을 완료하면 세션을 시작할 수 있습니다.' : '점검을 마치고 대기실에서 강사의 시작을 기다려 주세요.'}</p></div></Panel></div>
    <Panel title="레슨 준비 상태" description="시작 조건은 서버에서 다시 검증합니다."><ul className="check-grid"><li><span>✓</span><div><strong>레슨 게시</strong><small>PUBLISHED</small></div></li><li><span>✓</span><div><strong>PPTX 자료</strong><small>2개 준비</small></div></li><li><span>✓</span><div><strong>AI 준비</strong><small>READY</small></div></li><li><span>✓</span><div><strong>자료 작업</strong><small>진행 중 없음</small></div></li></ul></Panel>
    <Panel title="녹화와 학습 기능 안내"><div className="notice-grid"><div><strong>녹화</strong><p>Egress로 녹화되며 검수 후 다시보기로 공개됩니다.</p></div><div><strong>자막</strong><p>실시간 자막과 교정 자막을 제공합니다.</p></div><div><strong>채팅·AI</strong><p>질문과 근거 기반 답변이 수업 맥락에 연결됩니다.</p></div></div></Panel>
    <InlineNotice tone="info">세션 식별자: {sessionId}. 예정 시각만으로 상태를 바꾸지 않고 서버 상태를 사용합니다.</InlineNotice>
    <div className="sticky-form-actions">{isInstructor ? <><Link className="button button--soft" to={instructorPaths.editLiveSession(sessionId)}>일정 수정</Link><Link className="button button--primary button--large" to={instructorPaths.preflight(sessionId)}>강사 사전 점검</Link></> : <Link className="button button--primary button--large" to={studentPaths.prejoin(sessionId)}>입장 전 점검</Link>}</div>
  </div>
}
