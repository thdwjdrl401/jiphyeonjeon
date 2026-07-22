import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { instructorPaths, publicPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { demoCurriculum, demoLesson, getDemoLesson, getDemoLiveSession } from '@/features/demo/demoData'
import { isLiveEntryOpen } from '@/features/live-session/liveEntry'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

function formatScheduleTime(date: Date) {
  const period = date.getHours() < 12 ? '오전' : '오후'
  const hours = date.getHours() % 12 || 12
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${period} ${hours}:${minutes}`
}

export default function LessonDetailPage() {
  const { curriculumId = demoCurriculum.curriculumId, sectionId = 'sec-security', lessonId = demoLesson.lessonId } = useParams()
  const { user } = useAuth()
  const [entryNotice, setEntryNotice] = useState('')
  const isInstructor = user?.role === 'INSTRUCTOR'
  const lesson = getDemoLesson(lessonId, user?.userId)
  const liveSession = lesson.liveSession ? getDemoLiveSession(lesson.liveSession.sessionId) : null
  const curriculumPath = publicPaths.curriculum(curriculumId)
  const editLessonPath = instructorPaths.editLesson(curriculumId, sectionId, lessonId)
  const replayPath = isInstructor ? instructorPaths.replay(lessonId) : studentPaths.replay(lessonId)
  const showReplay = lesson.liveSession?.status === 'ENDING' || lesson.liveSession?.status === 'ENDED'
  const canEnterLive = lesson.liveSession ? isLiveEntryOpen(lesson.liveSession) : false
  const canReplay = lesson.replayStatus === 'PUBLISHED'
  const replayProgress = lesson.learning?.progressPercent ?? 0
  const materialWorkInProgress = lesson.materials.some((material) => material.status !== 'READY')
  const scheduledDate = liveSession?.scheduledAt ? new Date(liveSession.scheduledAt) : null
  const entryDate = scheduledDate ? new Date(scheduledDate.getTime() - 10 * 60_000) : null
  const liveStatusLabel = liveSession && ['OPEN', 'STARTING', 'LIVE'].includes(liveSession.status) ? '입장 가능' : '예정'
  usePageTitle(lesson.title)

  return (
    <div className="workspace-page">
      <div className="breadcrumbs"><Link to={curriculumPath}>{lesson.curriculumTitle}</Link><span>/</span><span>{lesson.sectionTitle}</span><span>/</span><strong>{lesson.title}</strong></div>
      <PageHeader
        eyebrow="LESSON HUB"
        title={lesson.title}
        description={lesson.description}
        action={<div className="header-action-group">{isInstructor && <Link className="button button--primary" to={editLessonPath}>강의 수정</Link>}<StatusBadge tone="success">{lesson.lessonStatus}</StatusBadge></div>}
      />
      <div className={isInstructor ? 'lesson-hub-grid' : undefined}>
        {isInstructor && <Panel title="강의 준비 상태" description="강의, 자료와 AI 준비 상태를 확인합니다."><ul className="readiness-list"><li><span>강의 게시</span><StatusBadge tone="success">PUBLISHED</StatusBadge></li><li><span>필수 PPTX</span><StatusBadge tone="success">{lesson.materials.length}개 준비</StatusBadge></li><li><span>AI 준비</span><StatusBadge tone="success">READY</StatusBadge></li><li><span>자료 작업</span><StatusBadge tone={materialWorkInProgress ? 'warning' : 'success'}>{materialWorkInProgress ? '진행 중' : '완료'}</StatusBadge></li></ul></Panel>}
        <Panel title="활성 강의 자료" description="수강생에게 공개되는 PPTX 원본입니다."><ul className="material-list material-list--compact">{lesson.materials.map((material) => <li key={material.id}><span className="file-icon">PPTX</span><div><strong>{material.name}</strong><small>{material.size}</small></div><button className="text-button" type="button">다운로드</button></li>)}</ul></Panel>
      </div>
      {!showReplay ? (
        <Panel title="라이브 강의" description="라이브 일정과 실제 진행 상태를 강의에서 함께 확인합니다.">
          {liveSession && scheduledDate && entryDate ? <>
            <div className="session-detail-grid lesson-live-details">
              <section className="lesson-live-card" aria-labelledby="lesson-live-schedule-heading">
                <h3 id="lesson-live-schedule-heading">라이브 일정</h3>
                <div className="big-schedule"><div><span>{scheduledDate.getMonth() + 1}월</span><strong>{String(scheduledDate.getDate()).padStart(2, '0')}</strong></div><dl><div><dt>시작</dt><dd>{formatScheduleTime(scheduledDate)}</dd></div><div><dt>입장 가능</dt><dd>{formatScheduleTime(entryDate)}부터</dd></div><div><dt>예상 시간</dt><dd>{liveSession.expectedDurationMinutes}분</dd></div></dl></div>
              </section>
              <section className="lesson-live-card" aria-labelledby="lesson-live-status-heading">
                <h3 id="lesson-live-status-heading">현재 상태</h3>
                <div className="state-hero"><StatusBadge tone={liveStatusLabel === '입장 가능' ? 'live' : 'warning'}>{liveStatusLabel}</StatusBadge><h4>{liveStatusLabel === '입장 가능' ? '라이브 강의를 시작할 수 있어요' : '라이브 시작을 기다리고 있어요'}</h4><p>{isInstructor ? '사전 점검을 완료하면 강의를 시작할 수 있습니다.' : '입장 전 점검을 마친 뒤 강사의 시작을 기다려 주세요.'}</p></div>
              </section>
            </div>
            <div className="notice-grid lesson-live-policies"><div><strong>녹화</strong><p>Egress로 녹화되며 검수 후 다시보기로 공개됩니다.</p></div><div><strong>자막</strong><p>실시간 자막과 교정 자막을 제공합니다.</p></div><div><strong>채팅·AI</strong><p>질문과 근거 기반 답변이 강의 맥락에 연결됩니다.</p></div></div>
            <div className="lesson-live-actions">{isInstructor ? <Link className="button button--primary" to={instructorPaths.preflight(liveSession.sessionId)}>사전 점검</Link> : canEnterLive ? <Link className="button button--primary" to={studentPaths.prejoin(liveSession.sessionId)}>입장</Link> : <button className="button button--primary" type="button" onClick={() => setEntryNotice('강의 시간이 아닙니다.')}>입장</button>}</div>
          </> : isInstructor ? <div className="empty-live-state"><InlineNotice tone="warning">연결된 라이브 일정이 없습니다. 강의 수정에서 라이브 강의 일정을 추가해 주세요.</InlineNotice><Link className="button button--primary" to={editLessonPath}>강의 수정에서 일정 추가</Link></div> : <InlineNotice>연결된 라이브 일정이 아직 없습니다.</InlineNotice>}
          {entryNotice && <InlineNotice tone="warning">{entryNotice}</InlineNotice>}
        </Panel>
      ) : (
        <Panel title="다시보기" description={isInstructor ? 'HLS 준비와 수강생 공개 상태를 분리해 표시합니다.' : undefined}>
          {isInstructor ? <div className="replay-summary"><div><StatusBadge tone="success">VIDEO READY</StatusBadge><StatusBadge tone="warning">REVIEW</StatusBadge><h3>녹화 영상 검수 가능</h3><p>교정 자막과 퀴즈는 검수 중이며 영상은 독립적으로 게시할 수 있습니다.</p></div><Link className="button button--primary" to={replayPath}>미리보기·검수</Link></div> : <div className="student-replay-summary"><div><span>진행도</span><strong>{replayProgress}%</strong></div>{canReplay ? <Link className="button button--primary" to={replayPath}>다시보기</Link> : <span className="replay-pending-label">다시 보기 준비 중</span>}</div>}
        </Panel>
      )}
    </div>
  )
}
