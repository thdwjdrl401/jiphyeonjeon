import { Link, useParams } from 'react-router-dom'
import { instructorPaths, publicPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { demoCurriculum, demoLesson, getDemoLesson } from '@/features/demo/demoData'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

export default function LessonDetailPage() {
  const { curriculumId = demoCurriculum.curriculumId, sectionId = 'sec-security', lessonId = demoLesson.lessonId } = useParams()
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const lesson = getDemoLesson(lessonId)
  const curriculumPath = isInstructor ? instructorPaths.curriculumManage(curriculumId) : publicPaths.curriculum(curriculumId)
  const liveSessionPath = lesson.liveSession
    ? isInstructor
      ? instructorPaths.liveSession(lesson.liveSession.sessionId)
      : studentPaths.liveSession(lesson.liveSession.sessionId)
    : null
  const replayPath = isInstructor ? instructorPaths.replay(lessonId) : studentPaths.replay(lessonId)
  usePageTitle(lesson.title)

  return (
    <div className="workspace-page">
      <div className="breadcrumbs"><Link to={curriculumPath}>{lesson.curriculumTitle}</Link><span>/</span><span>{lesson.sectionTitle}</span><span>/</span><strong>{lesson.title}</strong></div>
      <PageHeader eyebrow="LESSON HUB" title={lesson.title} description={lesson.description} action={<div className="header-action-group">{isInstructor && <Link className="button button--soft" to={instructorPaths.editLesson(curriculumId, sectionId, lessonId)}>레슨 수정</Link>}<StatusBadge tone="success">{lesson.lessonStatus}</StatusBadge></div>} />
      <div className="lesson-hub-grid">
        <Panel title="준비 상태" description="레슨, 자료, AI와 라이브 상태를 각각 확인합니다."><ul className="readiness-list"><li><span>레슨 게시</span><StatusBadge tone="success">PUBLISHED</StatusBadge></li><li><span>필수 PPTX</span><StatusBadge tone="success">2개 준비</StatusBadge></li><li><span>AI 준비</span><StatusBadge tone="success">READY</StatusBadge></li><li><span>진행 중 자료 작업</span><StatusBadge>없음</StatusBadge></li></ul></Panel>
        <Panel title="활성 강의 자료" description="수강생에게 공개되는 PPTX 원본입니다."><ul className="material-list material-list--compact">{lesson.materials.map((material) => <li key={material.id}><span className="file-icon">PPTX</span><div><strong>{material.name}</strong><small>{material.size}</small></div><button className="text-button" type="button">다운로드</button></li>)}</ul></Panel>
      </div>
      <Panel title="연결된 라이브 세션" description="세션 일정과 실제 진행 상태는 레슨 상태와 별도로 관리합니다.">{lesson.liveSession && liveSessionPath ? <div className="session-summary"><div className="session-summary__date"><strong>LIVE</strong><span>예상 90분</span></div><div><StatusBadge tone="live">{lesson.liveSession.status}</StatusBadge><h3>{lesson.title}</h3><p>녹화, 자막, 채팅, AI 사용</p></div><div className="card-actions"><Link className="button button--soft" to={liveSessionPath}>세션 상세</Link>{isInstructor && <Link className="button button--primary" to={instructorPaths.preflight(lesson.liveSession.sessionId)}>사전 점검</Link>}</div></div> : <InlineNotice>연결된 라이브 일정이 아직 없습니다.</InlineNotice>}</Panel>
      <Panel title="다시보기" description="HLS 준비와 수강생 공개 상태를 분리해 표시합니다."><div className="replay-summary"><div><StatusBadge tone="success">VIDEO READY</StatusBadge><StatusBadge tone="warning">REVIEW</StatusBadge><h3>녹화 영상 검수 가능</h3><p>교정 자막과 퀴즈는 검수 중이며 영상은 독립적으로 게시할 수 있습니다.</p></div><Link className="button button--primary" to={replayPath}>{isInstructor ? '미리보기·검수' : '다시보기'}</Link></div>{!isInstructor && <InlineNotice>강사가 다시보기를 게시하면 재생할 수 있습니다.</InlineNotice>}</Panel>
    </div>
  )
}
