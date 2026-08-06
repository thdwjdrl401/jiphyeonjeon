import { useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { instructorPaths, publicPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import CurriculumCoverFallback from '@/features/curriculum/CurriculumCoverFallback'
import {
  getInstructorCurriculums,
  getInstructorDashboardSummary,
  getStudentDashboardSummary,
} from '@/features/curriculum/myCurriculumsService'
import type { CurriculumLifecycleStatus } from '@/features/curriculum/types'
import type { StudentCurriculumItem } from '@/features/enrollment/types'
import { useCancelEnrollmentMutation } from '@/features/enrollment/useEnrollmentMutations'
import { useMyEnrollmentsQuery } from '@/features/enrollment/useEnrollmentQueries'
import BrowserPushPrompt from '@/features/notification/BrowserPushPrompt'
import { isNotImplemented } from '@/shared/api/notImplemented'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, MetricCard, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

const CURRICULUM_PAGE_SIZE = 4

function formatLessonMinutes(durationMs?: number | null) {
  if (!durationMs) return '--'
  return `${Math.round(durationMs / 60_000)}`
}

function formatMonthDay(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}.${String(date.getDate()).padStart(2, '0')}`
}

function formatHourMinute(date: Date) {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

function formatScheduleLabel(date: Date) {
  const yearPrefix = date.getFullYear() === new Date().getFullYear()
    ? ''
    : `${String(date.getFullYear() % 100).padStart(2, '0')}.`
  return `${yearPrefix}${formatMonthDay(date)} ${formatHourMinute(date)}`
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * 카드 배지는 <b>보는 사람의 관점</b>을 따른다. 강사에게 커리큘럼의 공개 상태는 곧 자기 할 일이지만,
 * 학생에게 "공개 중"은 남의 사정이다 — 학생이 내 커리큘럼에서 확인하려는 상태는 자기가 수강 중이라는
 * 사실이고, 이 목록 자체가 ACTIVE 수강만 담는다(승인 대기는 아래 별도 목록).
 *
 * <p>보관됨은 학생에게도 그대로 알린다. 강사가 내린 커리큘럼을 "수강 중"이라고 하면 오지 않을 새
 * 강의를 계속 기다리게 된다.
 */
function CurriculumStatusBadge({
  lifecycleStatus,
  isInstructor,
}: {
  lifecycleStatus: CurriculumLifecycleStatus
  isInstructor: boolean
}) {
  if (lifecycleStatus === 'ARCHIVED') return <StatusBadge tone="neutral">보관됨</StatusBadge>
  if (!isInstructor) return <StatusBadge tone="success">수강 중</StatusBadge>
  return lifecycleStatus === 'PUBLISHED'
    ? <StatusBadge tone="success">공개 중</StatusBadge>
    : <StatusBadge tone="warning">준비 중</StatusBadge>
}

function CurriculumPagination({
  label,
  page,
  totalPages,
  onPageChange,
}: {
  label: string
  page: number
  totalPages: number
  onPageChange: (page: number) => void
}) {
  if (totalPages <= 1) return null

  const visiblePageCount = Math.min(5, totalPages)
  const firstPage = Math.min(
    Math.max(0, page - Math.floor(visiblePageCount / 2)),
    totalPages - visiblePageCount,
  )
  const pageNumbers = Array.from({ length: visiblePageCount }, (_, index) => firstPage + index)

  return (
    <div className="pagination" role="navigation" aria-label={label}>
      {pageNumbers.map((pageNumber) => (
        <button
          className={`pagination__number${pageNumber === page ? ' is-current' : ''}`}
          type="button"
          aria-current={pageNumber === page ? 'page' : undefined}
          aria-label={`${pageNumber + 1}페이지`}
          key={pageNumber}
          onClick={() => onPageChange(pageNumber)}
        >
          {pageNumber + 1}
        </button>
      ))}
    </div>
  )
}

function PendingCurriculumCard({ item }: { item: StudentCurriculumItem }) {
  // 취소 성공·실패 알림은 useCancelEnrollmentMutation이 토스트로 낸다.
  const cancelMutation = useCancelEnrollmentMutation(item.curriculumId)

  return (
    <article className="dashboard-curriculum-card">
      <div className="dashboard-curriculum-card__cover">
        {item.thumbnailUrl
          ? <img src={item.thumbnailUrl} alt={`${item.title} 대표 이미지`} />
          : <CurriculumCoverFallback />}
      </div>
      <div className="dashboard-curriculum-card__content">
        <div>
          <StatusBadge tone="warning">승인 대기</StatusBadge>
          <h3><Link className="stretched-link" to={publicPaths.curriculum(item.curriculumId)}>{item.title}</Link></h3>
        </div>
        <div className="card-actions">
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
  const { user } = useAuth()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const pageTitle = isInstructor ? '커리큘럼 관리' : '내 커리큘럼'
  usePageTitle(pageTitle)
  const userId = user?.userId ?? ''
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const [pendingPage, setPendingPage] = useState(0)
  // 목록은 탐색·진입만 맡는다 — 삭제 같은 상태 변경은 관리 화면의 게시 카드에 모아 뒀다.
  const instructorListQuery = useQuery({
    queryKey: ['my-curriculums', 'instructor', userId, search, status, page],
    queryFn: () => getInstructorCurriculums({
      q: search || undefined,
      status: status === 'DRAFT' || status === 'PUBLISHED' ? status : undefined,
      page,
      size: CURRICULUM_PAGE_SIZE,
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
  const studentTotalPages = Math.ceil(filteredStudentCurriculums.length / CURRICULUM_PAGE_SIZE)
  const studentPage = Math.min(page, Math.max(0, studentTotalPages - 1))
  const displayedCurriculums = isInstructor
    ? instructorCurriculums
    : filteredStudentCurriculums.slice(
      studentPage * CURRICULUM_PAGE_SIZE,
      (studentPage + 1) * CURRICULUM_PAGE_SIZE,
    )
  const primaryTotalPages = isInstructor
    ? instructorListQuery.data?.totalPages ?? 0
    : studentTotalPages
  const primaryPage = isInstructor ? page : studentPage
  const pendingTotalPages = Math.ceil(pendingStudentCurriculums.length / CURRICULUM_PAGE_SIZE)
  const visiblePendingPage = Math.min(pendingPage, Math.max(0, pendingTotalPages - 1))
  const displayedPendingCurriculums = pendingStudentCurriculums.slice(
    visiblePendingPage * CURRICULUM_PAGE_SIZE,
    (visiblePendingPage + 1) * CURRICULUM_PAGE_SIZE,
  )
  const upcomingLive = isInstructor
    ? instructorSummaryQuery.data?.upcomingLiveSession
    : studentSummaryQuery.data?.upcomingLiveSession
  const upcomingLiveDate = upcomingLive?.scheduledAt ? new Date(upcomingLive.scheduledAt) : null
  const upcomingLiveDateLabel = upcomingLiveDate ? formatMonthDay(upcomingLiveDate) : '--.--'
  const upcomingLiveTimeLabel = upcomingLiveDate ? formatHourMinute(upcomingLiveDate) : '--:--'
  const upcomingLiveIsToday = upcomingLiveDate ? isSameDay(upcomingLiveDate, new Date()) : false
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
  // 수강 중이거나 운영 중인 강의가 하나도 없으면 받을 알림 자체가 없다 — 그런 사람에게 안내를 띄우지 않는다.
  const hasNotifiableCurriculums = isInstructor
    ? (instructorSummaryQuery.data?.totalCurriculumCount ?? instructorCurriculums.length) > 0
    : (studentSummaryQuery.data?.inProgressCurriculumCount ?? studentCurriculums.length) > 0

  return (
    <div className="workspace-page my-curriculums-page">
      <PageHeader
        title={pageTitle}
        action={isInstructor && <Link className="button button--primary" to={instructorPaths.newCurriculum}>새 커리큘럼</Link>}
      />

      {listError && <InlineNotice tone="danger">커리큘럼 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.</InlineNotice>}
      {!listError && summaryError && (
        <InlineNotice tone={isNotImplemented(summaryError) ? 'warning' : 'danger'}>
          {isNotImplemented(summaryError)
            ? '학습 요약은 아직 준비 중입니다. 아래 목록은 정상입니다.'
            : '학습 요약을 불러오지 못했습니다. 아래 목록은 정상입니다.'}
        </InlineNotice>
      )}

      <BrowserPushPrompt eligible={hasNotifiableCurriculums} />

      <div className="my-curriculums-page__layout">
        <div className="my-curriculums-page__main">
          <Panel className="my-curriculums-page__list-panel" title={isInstructor ? '운영 중인 커리큘럼' : '수강 중인 커리큘럼'} action={<div className="compact-controls"><input aria-label={`${pageTitle} 검색`} placeholder="제목 검색" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} /><select aria-label="상태 필터" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}><option value="">전체 상태</option>{isInstructor ? <><option value="PUBLISHED">공개 중</option><option value="DRAFT">준비 중</option></> : <><option value="ACTIVE">수강 중</option></>}</select></div>}>

            <div className="dashboard-curriculum-list">
              {displayedCurriculums.map((item) => (
                <article className="dashboard-curriculum-card" key={item.curriculumId}>
                  <div className="dashboard-curriculum-card__cover">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={`${item.title} 대표 이미지`} /> : <CurriculumCoverFallback />}</div>
                  {/*
                    카드 전체가 상세로 가는 링크다 — 제목 링크의 ::after가 카드를 덮는다(stretched link).
                    링크를 중첩하지 않으므로 관리 버튼은 z-index로 위에 떠 그대로 관리 페이지로 간다.
                  */}
                  <div className="dashboard-curriculum-card__content">
                    <div><CurriculumStatusBadge lifecycleStatus={item.lifecycleStatus} isInstructor={isInstructor} /><h3><Link className="stretched-link" to={publicPaths.curriculum(item.curriculumId)}>{item.title}</Link></h3></div>
                    {'progress' in item
                      ? <div className="dashboard-progress"><span><strong>{item.progress}%</strong> · {item.completedLessonCount}/{item.lessonCount} 강의</span><i><b style={{ width: `${item.progress}%` }} /></i></div>
                      : <p className="dashboard-meta">다음 일정 {item.nextLiveSession?.scheduledAt ? formatScheduleLabel(new Date(item.nextLiveSession.scheduledAt)) : '미정'}</p>}
                    {isInstructor && <div className="card-actions"><Link className="button button--soft" to={instructorPaths.curriculumManage(item.curriculumId)}>관리</Link></div>}
                  </div>
                </article>
              ))}
            </div>
            <CurriculumPagination
              label={isInstructor ? '운영 중인 커리큘럼 페이지' : '수강 중인 커리큘럼 페이지'}
              page={primaryPage}
              totalPages={primaryTotalPages}
              onPageChange={setPage}
            />
          </Panel>

          {/* 대기 목록은 신청한 학생에게만 주 목록 아래에 표시한다. */}
          {!isInstructor && pendingStudentCurriculums.length > 0 && (
            <Panel title="승인 대기 중인 커리큘럼" description="강사가 수강 신청을 승인하면 나의 학습 목록에서 바로 시작할 수 있어요.">
              <div className="dashboard-curriculum-list">{displayedPendingCurriculums.map((item) => <PendingCurriculumCard key={item.curriculumId} item={item} />)}</div>
              <CurriculumPagination
                label="승인 대기 중인 커리큘럼 페이지"
                page={visiblePendingPage}
                totalPages={pendingTotalPages}
                onPageChange={setPendingPage}
              />
            </Panel>
          )}
        </div>

        <aside className="my-curriculums-page__sidebar" aria-label="커리큘럼 요약">
          <div className="metric-grid">
            {isInstructor ? <><MetricCard label="운영 커리큘럼" value={instructorSummaryQuery.data?.totalCurriculumCount ?? '--'} /><MetricCard label="공개 중" value={instructorSummaryQuery.data?.publishedCurriculumCount ?? '--'} /><MetricCard label="예정 라이브" value={instructorSummaryQuery.data?.upcomingLiveCount ?? '--'} /><MetricCard label="전체 수강생" value={instructorSummaryQuery.data?.totalEnrolleeCount == null ? '--' : `${instructorSummaryQuery.data.totalEnrolleeCount}명`} /></> : <><MetricCard label="수강 중인 커리큘럼" value={studentSummaryQuery.data?.inProgressCurriculumCount ?? '--'} /><MetricCard label="완료한 커리큘럼" value={studentSummaryQuery.data?.completedCurriculumCount ?? '--'} /><MetricCard label="평균 진행률" value={studentSummaryQuery.data ? `${studentSummaryQuery.data.averageProgress}%` : '--'} /><MetricCard label="완료한 강의" value={studentSummaryQuery.data ? `${studentSummaryQuery.data.completedLessonCount}개` : '--'} /></>}
          </div>

          {/* 가장 가까운 예정/진행 라이브 하나를 요약한다. */}
          {upcomingLive && upcomingLiveActionPath ? (
            <Panel
              className="highlight-panel"
              title={upcomingLiveIsToday ? '오늘의 라이브 강의' : '다음 라이브 강의'}
              description={upcomingLiveIsToday
                ? '오늘 예정된 라이브 강의입니다.'
                : '오늘은 예정된 강의가 없어 가장 이른 다음 강의를 보여 줍니다.'}
            >
              <div className="next-action-card">
                <div className="next-action-card__date"><strong>{upcomingLiveDateLabel}</strong><span>{upcomingLiveTimeLabel}</span></div>
                <div>
                  <StatusBadge tone={['OPEN', 'STARTING', 'LIVE'].includes(upcomingLive.liveSessionStatus) ? 'live' : 'warning'}>{['OPEN', 'STARTING', 'LIVE'].includes(upcomingLive.liveSessionStatus) ? '입장 가능' : '예정'}</StatusBadge>
                  <h3>{upcomingLive.lessonTitle}</h3>
                  <p>{upcomingLive.curriculumTitle} · 예상 {formatLessonMinutes(upcomingLive.durationMs)}분</p>
                </div>
                <Link className="button button--primary" to={upcomingLiveActionPath}>강의 상세</Link>
              </div>
            </Panel>
          ) : (
            <p className="today-live-empty"><b>다음 라이브</b><span>예정된 라이브 강의가 없어요.</span></p>
          )}
        </aside>
      </div>
    </div>
  )
}
