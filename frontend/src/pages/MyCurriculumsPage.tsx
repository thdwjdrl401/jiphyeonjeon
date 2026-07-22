import { useState } from 'react'
import { Link } from 'react-router-dom'
import { instructorPaths, publicPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import {
  getDemoInstructorCurriculums,
  getDemoPendingStudentCurriculums,
  getDemoStudentLearningSummary,
  getDemoStudentCurriculums,
  getDemoTodayInstructorLiveSession,
  getDemoTodayLiveSession,
} from '@/features/demo/demoData'
import { useCancelEnrollmentMutation } from '@/features/curriculum-detail/useEnrollmentMutations'
import { ApiError } from '@/shared/api/client'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { MetricCard, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

function formatLessonMinutes(durationMs: number | null) {
  if (!durationMs) return '--'
  return `${Math.round(durationMs / 60_000)}`
}

type PendingCurriculum = ReturnType<typeof getDemoPendingStudentCurriculums>[number]

function PendingCurriculumCard({ item, onCancelled }: { item: PendingCurriculum; onCancelled: () => void }) {
  const cancelMutation = useCancelEnrollmentMutation(item.curriculumId)
  const cancelError = cancelMutation.error instanceof ApiError ? cancelMutation.error.message : null

  return (
    <article className="dashboard-curriculum-card">
      <div className="dashboard-curriculum-card__cover">
        {item.thumbnailUrl && <img src={item.thumbnailUrl} alt={`${item.title} 대표 이미지`} />}
      </div>
      <div className="dashboard-curriculum-card__content">
        <div>
          <StatusBadge tone="warning">승인 대기</StatusBadge>
          <h3>{item.title}</h3>
          <p>{item.summary}</p>
          {cancelError && <p className="form-error" role="alert">{cancelError}</p>}
        </div>
        <p className="dashboard-meta">{item.instructor} 강사 · 승인 후 학습 가능</p>
        <div className="card-actions">
          <Link className="button button--soft" to={publicPaths.curriculum(item.curriculumId)}>커리큘럼 상세</Link>
          <button
            className="button button--ghost"
            type="button"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate(undefined, { onSuccess: onCancelled })}
          >
            {cancelMutation.isPending ? '취소 중' : '수강 신청 취소'}
          </button>
        </div>
      </div>
    </article>
  )
}

export default function MyCurriculumsPage() {
  usePageTitle('내 커리큘럼')
  const { user } = useAuth()
  const [, refreshPendingCurriculums] = useState(0)
  const isInstructor = user?.role === 'INSTRUCTOR'
  const instructorCurriculums = getDemoInstructorCurriculums(user?.userId ?? '')
  const studentCurriculums = getDemoStudentCurriculums(user?.userId ?? '')
  const pendingStudentCurriculums = getDemoPendingStudentCurriculums(user?.userId ?? '')
  const curriculums = isInstructor ? instructorCurriculums : studentCurriculums
  const studentSummary = getDemoStudentLearningSummary(user?.userId ?? '')

  const upcomingLive = isInstructor
    ? getDemoTodayInstructorLiveSession(user?.userId ?? '')
    : getDemoTodayLiveSession(user?.userId ?? '')
  const upcomingLiveDate = upcomingLive?.scheduledAt ? new Date(upcomingLive.scheduledAt) : null
  const upcomingLiveDateLabel = upcomingLiveDate
    ? `${String(upcomingLiveDate.getMonth() + 1).padStart(2, '0')}.${String(upcomingLiveDate.getDate()).padStart(2, '0')}`
    : '--.--'
  const upcomingLiveTimeLabel = upcomingLiveDate
    ? `${String(upcomingLiveDate.getHours()).padStart(2, '0')}:${String(upcomingLiveDate.getMinutes()).padStart(2, '0')}`
    : '--:--'
  const upcomingLiveActionPath = upcomingLive
    ? isInstructor
      ? instructorPaths.lesson(upcomingLive.curriculumId, upcomingLive.sectionId, upcomingLive.lessonId)
      : studentPaths.lesson(upcomingLive.curriculumId, upcomingLive.sectionId, upcomingLive.lessonId)
    : null

  return (
    <div className="workspace-page">
      <PageHeader eyebrow={isInstructor ? 'INSTRUCTOR DASHBOARD' : 'LEARNING DASHBOARD'} title="내 커리큘럼" description={isInstructor ? '운영 상태와 오늘의 라이브 강의를 한눈에 확인하세요.' : '최근 학습과 오늘의 라이브 강의를 확인하세요.'} />

      <div className="metric-grid">
        {isInstructor ? <><MetricCard label="운영 커리큘럼" value={instructorCurriculums.length} /><MetricCard label="공개 중" value={instructorCurriculums.filter((curriculum) => curriculum.lifecycleStatus === 'PUBLISHED').length} /><MetricCard label="예정 라이브" value={instructorCurriculums.filter((curriculum) => curriculum.nextSession !== '일정 미정').length} /><MetricCard label="전체 수강생" value={`${instructorCurriculums.reduce((sum, curriculum) => sum + curriculum.enrolleeCount, 0)}명`} /></> : <><MetricCard label="수강 중인 커리큘럼" value={studentSummary.inProgressCurriculumCount} /><MetricCard label="완료한 커리큘럼" value={studentSummary.completedCurriculumCount} /><MetricCard label="평균 진행률" value={`${studentSummary.averageProgress}%`} /><MetricCard label="완료한 강의" value={`${studentSummary.completedLessonCount}개`} /></>}
      </div>

      <Panel className="highlight-panel" title="오늘의 라이브 강의" description="오늘 예정된 라이브 강의만 표시합니다.">
        {upcomingLive && upcomingLiveActionPath ? (
          <div className="next-action-card">
            <div className="next-action-card__date"><strong>{upcomingLiveDateLabel}</strong><span>{upcomingLiveTimeLabel}</span></div>
            <div>
              <StatusBadge tone={upcomingLive.liveSessionStatus === 'LIVE' || upcomingLive.liveSessionStatus === 'OPEN' ? 'live' : 'warning'}>{upcomingLive.liveSessionStatus === 'LIVE' || upcomingLive.liveSessionStatus === 'OPEN' ? '입장 가능' : '예정'}</StatusBadge>
              <h3>{upcomingLive.lessonTitle}</h3>
              <p>{upcomingLive.curriculumTitle} · 예상 {formatLessonMinutes(upcomingLive.durationMs)}분</p>
            </div>
            <Link className="button button--primary" to={upcomingLiveActionPath}>강의 상세</Link>
          </div>
        ) : (
          <p className="dashboard-meta">오늘 예정된 라이브 강의가 없어요.</p>
        )}
      </Panel>

      <Panel title={isInstructor ? '운영 중인 커리큘럼' : '나의 학습 목록'} action={<div className="compact-controls">{isInstructor && <Link className="button button--primary" to={instructorPaths.newCurriculum}>새 커리큘럼</Link>}<input aria-label="내 커리큘럼 검색" placeholder="제목 검색" /><select aria-label="상태 필터"><option>전체 상태</option><option>{isInstructor ? '공개 중' : '학습 중'}</option><option>{isInstructor ? '준비 중' : '완료'}</option></select></div>}>
        <div className="dashboard-curriculum-list">
          {curriculums.map((item) => {
            return (
              <article className="dashboard-curriculum-card" key={item.curriculumId}>
                <div className="dashboard-curriculum-card__cover"><img src={item.thumbnailUrl ?? undefined} alt={`${item.title} 대표 이미지`} /></div>
                <div className="dashboard-curriculum-card__content"><div><StatusBadge tone={item.lifecycleStatus === 'PUBLISHED' ? 'success' : 'warning'}>{item.lifecycleStatus === 'PUBLISHED' ? '공개 중' : '준비 중'}</StatusBadge><h3>{item.title}</h3><p>{item.summary}</p></div>{'progress' in item ? <div className="dashboard-progress"><span><strong>{item.progress}%</strong> · {item.completedLessonCount}/{item.lessonCount} 강의</span><i><b style={{ width: `${item.progress}%` }} /></i></div> : <p className="dashboard-meta">게시 강의 {item.publishedLessonCount}/{item.lessonCount} · 다음 일정 {item.nextSession}</p>}<div className="card-actions"><Link className="button button--primary" to={publicPaths.curriculum(item.curriculumId)}>커리큘럼 상세</Link></div></div>
              </article>
            )
          })}
        </div>
      </Panel>

      {!isInstructor && (
        <Panel
          title="승인 대기 중인 커리큘럼"
          description="강사가 수강 신청을 승인하면 나의 학습 목록에서 바로 시작할 수 있어요."
        >
          {pendingStudentCurriculums.length > 0 ? (
            <div className="dashboard-curriculum-list">
              {pendingStudentCurriculums.map((item) => <PendingCurriculumCard key={item.curriculumId} item={item} onCancelled={() => refreshPendingCurriculums((value) => value + 1)} />)}
            </div>
          ) : (
            <p>현재 승인 대기 중인 커리큘럼이 없습니다.</p>
          )}
        </Panel>
      )}
    </div>
  )
}
