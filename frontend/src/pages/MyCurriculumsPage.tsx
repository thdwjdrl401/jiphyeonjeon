import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { instructorPaths, publicPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import {
  getInstructorCurriculums,
  getInstructorDashboardSummary,
  getStudentDashboardSummary,
} from '@/features/curriculum/myCurriculumsService'
import type { StudentCurriculumItem } from '@/features/enrollment/types'
import { useCancelEnrollmentMutation } from '@/features/enrollment/useEnrollmentMutations'
import { useMyEnrollmentsQuery } from '@/features/enrollment/useEnrollmentQueries'
import { ApiError } from '@/shared/api/client'
import { isNotImplemented } from '@/shared/api/notImplemented'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, MetricCard, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

function formatLessonMinutes(durationMs?: number | null) {
  if (!durationMs) return '--'
  return `${Math.round(durationMs / 60_000)}`
}

function PendingCurriculumCard({ item }: { item: StudentCurriculumItem }) {
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
            onClick={() => cancelMutation.mutate()}
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
  const isInstructor = user?.role === 'INSTRUCTOR'
  const userId = user?.userId ?? ''
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)

  const instructorListQuery = useQuery({
    queryKey: ['my-curriculums', 'instructor', userId, search, status, page],
    queryFn: () => getInstructorCurriculums({
      q: search || undefined,
      status: status === 'DRAFT' || status === 'PUBLISHED' || status === 'ARCHIVED' ? status : undefined,
      page,
      size: 20,
    }, userId),
    enabled: Boolean(userId && isInstructor),
    placeholderData: keepPreviousData,
  })
  const studentListQuery = useMyEnrollmentsQuery(userId, Boolean(userId && !isInstructor))
  const instructorSummaryQuery = useQuery({
    queryKey: ['dashboard-summary', 'instructor', userId],
    queryFn: () => getInstructorDashboardSummary(userId),
    enabled: Boolean(userId && isInstructor),
  })
  const studentSummaryQuery = useQuery({
    queryKey: ['dashboard-summary', 'student', userId],
    queryFn: () => getStudentDashboardSummary(userId),
    enabled: Boolean(userId && !isInstructor),
  })

  if (!user) return null

  const instructorCurriculums = instructorListQuery.data?.items ?? []
  const studentCurriculums = (studentListQuery.data ?? []).filter((item) => item.enrollmentStatus === 'ACTIVE')
  const pendingStudentCurriculums = (studentListQuery.data ?? []).filter((item) => item.enrollmentStatus === 'PENDING')
  const filteredStudentCurriculums = studentCurriculums.filter((item) => {
    const matchesSearch = !search || item.title.toLocaleLowerCase('ko').includes(search.toLocaleLowerCase('ko'))
    const matchesStatus = !status || status === 'ACTIVE'
    return matchesSearch && matchesStatus
  })
  const upcomingLive = isInstructor
    ? instructorSummaryQuery.data?.todayLiveSession
    : studentSummaryQuery.data?.todayLiveSession
  const upcomingLiveDate = upcomingLive?.scheduledAt ? new Date(upcomingLive.scheduledAt) : null
  const upcomingLiveDateLabel = upcomingLiveDate
    ? `${String(upcomingLiveDate.getMonth() + 1).padStart(2, '0')}.${String(upcomingLiveDate.getDate()).padStart(2, '0')}`
    : '--.--'
  const upcomingLiveTimeLabel = upcomingLiveDate
    ? `${String(upcomingLiveDate.getHours()).padStart(2, '0')}:${String(upcomingLiveDate.getMinutes()).padStart(2, '0')}`
    : '--:--'
  const upcomingLiveActionPath = upcomingLive
    ? isInstructor
      ? instructorPaths.preflight(upcomingLive.sessionId)
      : studentPaths.prejoin(upcomingLive.sessionId)
    : null
  // 목록과 요약을 갈라서 본다. 요약(/me/learning-summary·/instructor/dashboard-summary)은
  // learning 배선 전까지 서버에 없어서 늘 실패하는데, 묶어 두면 목록이 멀쩡한데도
  // 페이지 전체에 오류 배너가 뜬다. 요약은 위쪽 지표 자리에서만 안내한다.
  const listError = isInstructor ? instructorListQuery.error : studentListQuery.error
  const summaryError = isInstructor ? instructorSummaryQuery.error : studentSummaryQuery.error

  return (
    <div className="workspace-page">
      <PageHeader eyebrow={isInstructor ? 'INSTRUCTOR DASHBOARD' : 'LEARNING DASHBOARD'} title="내 커리큘럼" description={isInstructor ? '운영 상태와 오늘의 라이브 강의를 한눈에 확인하세요.' : undefined} />

      {listError && <InlineNotice tone="danger">커리큘럼 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</InlineNotice>}
      {!listError && summaryError && (
        <InlineNotice tone={isNotImplemented(summaryError) ? 'warning' : 'danger'}>
          {isNotImplemented(summaryError)
            ? '학습 요약은 아직 준비 중입니다. 아래 목록은 정상입니다.'
            : '학습 요약을 불러오지 못했습니다. 아래 목록은 정상입니다.'}
        </InlineNotice>
      )}

      <div className="metric-grid">
        {isInstructor ? <><MetricCard label="운영 커리큘럼" value={instructorSummaryQuery.data?.totalCurriculumCount ?? '--'} /><MetricCard label="공개 중" value={instructorSummaryQuery.data?.publishedCurriculumCount ?? '--'} /><MetricCard label="예정 라이브" value={instructorSummaryQuery.data?.upcomingLiveCount ?? '--'} /><MetricCard label="전체 수강생" value={instructorSummaryQuery.data?.totalEnrolleeCount == null ? '--' : `${instructorSummaryQuery.data.totalEnrolleeCount}명`} /></> : <><MetricCard label="수강 중인 커리큘럼" value={studentSummaryQuery.data?.inProgressCurriculumCount ?? '--'} /><MetricCard label="완료한 커리큘럼" value={studentSummaryQuery.data?.completedCurriculumCount ?? '--'} /><MetricCard label="평균 진행률" value={studentSummaryQuery.data ? `${studentSummaryQuery.data.averageProgress}%` : '--'} /><MetricCard label="완료한 강의" value={studentSummaryQuery.data ? `${studentSummaryQuery.data.completedLessonCount}개` : '--'} /></>}
      </div>

      <Panel className="highlight-panel" title="오늘의 라이브 강의" description="오늘 예정된 라이브 강의만 표시합니다.">
        {upcomingLive && upcomingLiveActionPath ? (
          <div className="next-action-card">
            <div className="next-action-card__date"><strong>{upcomingLiveDateLabel}</strong><span>{upcomingLiveTimeLabel}</span></div>
            <div>
              <StatusBadge tone={['OPEN', 'STARTING', 'LIVE'].includes(upcomingLive.liveSessionStatus) ? 'live' : 'warning'}>{['OPEN', 'STARTING', 'LIVE'].includes(upcomingLive.liveSessionStatus) ? '입장 가능' : '예정'}</StatusBadge>
              <h3>{upcomingLive.lessonTitle}</h3>
              <p>{upcomingLive.curriculumTitle} · 예상 {formatLessonMinutes(upcomingLive.durationMs)}분</p>
            </div>
            <Link className="button button--primary" to={upcomingLiveActionPath}>강의 상세</Link>
          </div>
        ) : (
          <p className="dashboard-meta">오늘 예정된 라이브 강의가 없어요.</p>
        )}
      </Panel>

      <Panel title={isInstructor ? '운영 중인 커리큘럼' : '나의 학습 목록'} action={<div className="compact-controls">{isInstructor && <Link className="button button--primary" to={instructorPaths.newCurriculum}>새 커리큘럼</Link>}<input aria-label="내 커리큘럼 검색" placeholder="제목 검색" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} /><select aria-label="상태 필터" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}><option value="">전체 상태</option>{isInstructor ? <><option value="PUBLISHED">공개 중</option><option value="DRAFT">준비 중</option><option value="ARCHIVED">보관됨</option></> : <><option value="ACTIVE">학습 중</option></>}</select></div>}>
        <div className="dashboard-curriculum-list">
          {(isInstructor ? instructorCurriculums : filteredStudentCurriculums).map((item) => (
            <article className="dashboard-curriculum-card" key={item.curriculumId}>
              <div className="dashboard-curriculum-card__cover">{item.thumbnailUrl && <img src={item.thumbnailUrl} alt={`${item.title} 대표 이미지`} />}</div>
              <div className="dashboard-curriculum-card__content"><div><StatusBadge tone={item.lifecycleStatus === 'PUBLISHED' ? 'success' : item.lifecycleStatus === 'ARCHIVED' ? 'neutral' : 'warning'}>{item.lifecycleStatus === 'PUBLISHED' ? '공개 중' : item.lifecycleStatus === 'ARCHIVED' ? '보관됨' : '준비 중'}</StatusBadge><h3>{item.title}</h3><p>{item.summary}</p></div>{'progress' in item ? <div className="dashboard-progress"><span><strong>{item.progress}%</strong> · {item.completedLessonCount}/{item.lessonCount} 강의</span><i><b style={{ width: `${item.progress}%` }} /></i></div> : <p className="dashboard-meta">섹션 {item.sectionCount} · 게시 강의 {item.publishedLessonCount}/{item.lessonCount} · 다음 일정 {item.nextLiveSession?.scheduledAt ? new Date(item.nextLiveSession.scheduledAt).toLocaleString('ko-KR') : '일정 미정'}</p>}<div className="card-actions"><Link className="button button--primary" to={publicPaths.curriculum(item.curriculumId)}>커리큘럼 상세</Link>{isInstructor && <Link className="button button--soft" to={instructorPaths.curriculumManage(item.curriculumId)}>관리</Link>}</div></div>
            </article>
          ))}
        </div>
        {isInstructor && instructorListQuery.data && instructorListQuery.data.totalPages > 1 && <div className="pagination"><button type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>이전</button><span>{page + 1} / {instructorListQuery.data.totalPages}</span><button type="button" disabled={!instructorListQuery.data.hasNext} onClick={() => setPage((current) => current + 1)}>다음</button></div>}
      </Panel>

      {!isInstructor && (
        <Panel title="승인 대기 중인 커리큘럼" description="강사가 수강 신청을 승인하면 나의 학습 목록에서 바로 시작할 수 있어요.">
          {pendingStudentCurriculums.length > 0 ? <div className="dashboard-curriculum-list">{pendingStudentCurriculums.map((item) => <PendingCurriculumCard key={item.curriculumId} item={item} />)}</div> : <p>현재 승인 대기 중인 커리큘럼이 없습니다.</p>}
        </Panel>
      )}
    </div>
  )
}
