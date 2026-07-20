import { Link } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import { demoInstructorCurriculums, demoSession, demoStudentCurriculums } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { MetricCard, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

export default function MyCurriculumsPage() {
  usePageTitle('내 커리큘럼')
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const curriculums = isInstructor ? demoInstructorCurriculums : demoStudentCurriculums

  return (
    <div className="workspace-page">
      <PageHeader eyebrow={isInstructor ? 'INSTRUCTOR DASHBOARD' : 'LEARNING DASHBOARD'} title="내 커리큘럼" description={isInstructor ? '운영 상태와 다음 라이브 준비 작업을 한눈에 확인하세요.' : '최근 학습과 예정된 라이브를 이어서 만나보세요.'} action={<Link className="button button--primary" to={isInstructor ? '/curriculums/new' : '/curriculums'}>{isInstructor ? '새 커리큘럼' : '커리큘럼 탐색'}</Link>} />

      <div className="metric-grid">
        {isInstructor ? <><MetricCard label="운영 커리큘럼" value={curriculums.length} /><MetricCard label="공개 중" value="1" /><MetricCard label="예정 라이브" value="2" /><MetricCard label="전체 수강생" value="76명" /></> : <><MetricCard label="수강 중" value={curriculums.length} /><MetricCard label="완료한 레슨" value="16개" /><MetricCard label="평균 진행률" value="59%" /><MetricCard label="예정 라이브" value="1" /></>}
      </div>

      <Panel className="highlight-panel" title={isInstructor ? '가장 가까운 라이브' : '다음 학습'} description={isInstructor ? '시작 전 레슨과 장치 준비 상태를 확인해 주세요.' : '마지막으로 보던 지점에서 바로 이어갈 수 있어요.'}>
        <div className="next-action-card"><div className="next-action-card__date"><strong>08.01</strong><span>10:00</span></div><div><StatusBadge tone="live">{demoSession.status}</StatusBadge><h3>Spring Security 시작하기</h3><p>라이브로 완성하는 Spring Boot · 예상 90분</p></div><Link className="button button--primary" to={isInstructor ? `/instructor/live-sessions/${demoSession.sessionId}/preflight` : `/lessons/les_security/replay`}>{isInstructor ? '사전 점검' : '이어보기'}</Link></div>
      </Panel>

      <Panel title={isInstructor ? '운영 중인 커리큘럼' : '나의 학습 목록'} action={<div className="compact-controls"><input aria-label="내 커리큘럼 검색" placeholder="제목 검색" /><select aria-label="상태 필터"><option>전체 상태</option><option>{isInstructor ? '공개 중' : '학습 중'}</option><option>{isInstructor ? '준비 중' : '완료'}</option></select></div>}>
        <div className="dashboard-curriculum-list">
          {curriculums.map((item) => (
            <article className="dashboard-curriculum-card" key={item.curriculumId}>
              <div className="dashboard-curriculum-card__cover"><span>{item.title.slice(0, 1)}</span></div>
              <div className="dashboard-curriculum-card__content"><div><StatusBadge tone={item.lifecycleStatus === 'PUBLISHED' ? 'success' : 'warning'}>{item.lifecycleStatus === 'PUBLISHED' ? '공개 중' : '준비 중'}</StatusBadge><h3>{item.title}</h3><p>{item.summary}</p></div>{'progress' in item ? <div className="dashboard-progress"><span><strong>{item.progress}%</strong> · {item.completedLessonCount}/{item.lessonCount} 레슨</span><i><b style={{ width: `${item.progress}%` }} /></i></div> : <p className="dashboard-meta">게시 레슨 {item.publishedLessonCount}/{item.lessonCount} · 다음 일정 {item.nextSession}</p>}<div className="card-actions"><Link className="button button--soft" to={`/curriculums/${item.curriculumId}`}>상세</Link><Link className="button button--primary" to={isInstructor ? `/curriculums/${item.curriculumId}/manage` : `/lessons/${'lastLessonId' in item ? item.lastLessonId : 'les_security'}/replay`}>{isInstructor ? '관리하기' : '학습 계속하기'}</Link></div></div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  )
}
