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
import type { InstructorCurriculumItem } from '@/features/curriculum/myCurriculumsService.interface'
import type { StudentCurriculumItem } from '@/features/enrollment/types'
import { useCancelEnrollmentMutation } from '@/features/enrollment/useEnrollmentMutations'
import { useMyEnrollmentsQuery } from '@/features/enrollment/useEnrollmentQueries'
import { isNotImplemented } from '@/shared/api/notImplemented'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import { InlineNotice, MetricCard, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

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

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

/**
 * 카드 메타의 일정 표기. `toLocaleString('ko-KR')`은 "2026. 8. 3. 오후 2:00:00"처럼 길어서
 * 좁은 칸을 혼자 여러 줄로 밀어낸다. 같은 해면 "08.03 14:00", 해가 다르면 "26.08.03 14:00".
 */
function formatScheduleLabel(date: Date) {
  const yearPrefix = date.getFullYear() === new Date().getFullYear()
    ? ''
    : `${String(date.getFullYear() % 100).padStart(2, '0')}.`
  return `${yearPrefix}${formatMonthDay(date)} ${formatHourMinute(date)}`
}

/**
 * 강사 카드의 메타 항목들. 한 문자열로 이어 붙이지 않고 항목 단위로 끊어서 낸다 — 좁은 칸에서
 * 한국어 토큰 중간이 잘리거나 구분점('·')만 줄에 남는 것을 막는다(구분점은 CSS가 그린다).
 *
 * 커리큘럼이 비공개면 강의를 다 게시했어도 수강생에게는 0개다
 * (ADR-0002: 공개 = 커리큘럼 PUBLISHED AND 강의 PUBLISHED). "게시 강의 5/5"만 보여 주면
 * 공개된 것으로 오해하므로, 비공개일 때는 그 사실을 강의 수보다 먼저 말한다.
 * 공개 중일 때는 같은 카드의 상태 배지가 이미 "공개 중"이라고 말하므로 메타에서 반복하지 않는다.
 */
function instructorMetaItems(item: InstructorCurriculumItem) {
  const visibility = item.lifecycleStatus === 'PUBLISHED'
    ? []
    : item.lifecycleStatus === 'ARCHIVED'
      ? ['비공개']
      : ['비공개', '게시해야 공개']
  const nextLive = item.nextLiveSession?.scheduledAt ? new Date(item.nextLiveSession.scheduledAt) : null
  return [
    `섹션 ${item.sectionCount}`,
    ...visibility,
    `강의 ${item.publishedLessonCount}/${item.lessonCount} 게시`,
    `다음 일정 ${nextLive ? formatScheduleLabel(nextLive) : '미정'}`,
  ]
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
          <h3>{item.title}</h3>
          <p className="dashboard-curriculum-card__summary" title={item.summary}>{item.summary}</p>
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
  // 목록은 탐색·진입만 맡는다 — 삭제 같은 상태 변경은 관리 화면의 게시 카드에 모아 뒀다.
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

  return (
    <div className="workspace-page my-curriculums-page">
      <PageHeader title="내 커리큘럼" description={isInstructor ? '운영 상태와 다가오는 라이브 강의를 한눈에 확인하세요.' : undefined} />

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

      {/*
        서버의 `todayLiveSession`은 이름과 달리 "오늘"로 걸러 오지 않는다 —
        CatalogService.nearestLiveSession()이 예정/진행 세션 중 scheduledAt이 가장 이른 하나를
        고를 뿐이라, 오늘 예정이 없으면 내일·다음 주 세션이 그대로 올라온다. 그래서 제목을
        "오늘의 라이브 강의"로 못 박지 않고, 실제로 받은 날짜를 보고 정한다.

        라이브가 있으면 강조 패널을 그대로 쓴다. 없으면 "없어요" 한 줄에 패널 한 장
        (제목·설명·본문)을 쓰지 않고 한 줄 띠로 줄인다.
      */}
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

      <Panel title={isInstructor ? '운영 중인 커리큘럼' : '나의 학습 목록'} action={<div className="compact-controls">{isInstructor && <Link className="button button--primary" to={instructorPaths.newCurriculum}>새 커리큘럼</Link>}<input aria-label="내 커리큘럼 검색" placeholder="제목 검색" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} /><select aria-label="상태 필터" value={status} onChange={(event) => { setStatus(event.target.value); setPage(0) }}><option value="">전체 상태</option>{isInstructor ? <><option value="PUBLISHED">공개 중</option><option value="DRAFT">준비 중</option><option value="ARCHIVED">보관됨</option></> : <><option value="ACTIVE">학습 중</option></>}</select></div>}>
        <div className="dashboard-curriculum-list">
          {(isInstructor ? instructorCurriculums : filteredStudentCurriculums).map((item) => (
            <article className="dashboard-curriculum-card" key={item.curriculumId}>
              <div className="dashboard-curriculum-card__cover">{item.thumbnailUrl ? <img src={item.thumbnailUrl} alt={`${item.title} 대표 이미지`} /> : <CurriculumCoverFallback />}</div>
              {/*
                카드 전체가 상세로 가는 링크다 — 제목 링크의 ::after가 카드를 덮는다(stretched link).
                링크를 중첩하지 않으므로 관리 버튼은 z-index로 위에 떠 그대로 관리 페이지로 간다.
              */}
              <div className="dashboard-curriculum-card__content">
                <div><StatusBadge tone={item.lifecycleStatus === 'PUBLISHED' ? 'success' : item.lifecycleStatus === 'ARCHIVED' ? 'neutral' : 'warning'}>{item.lifecycleStatus === 'PUBLISHED' ? '공개 중' : item.lifecycleStatus === 'ARCHIVED' ? '보관됨' : '준비 중'}</StatusBadge><h3><Link className="stretched-link" to={publicPaths.curriculum(item.curriculumId)}>{item.title}</Link></h3><p className="dashboard-curriculum-card__summary" title={item.summary}>{item.summary}</p></div>
                {'progress' in item
                  ? <div className="dashboard-progress"><span><strong>{item.progress}%</strong> · {item.completedLessonCount}/{item.lessonCount} 강의</span><i><b style={{ width: `${item.progress}%` }} /></i></div>
                  : <div className="dashboard-meta dashboard-meta--split">{instructorMetaItems(item).map((meta) => <span key={meta}>{meta}</span>)}</div>}
                {isInstructor && <div className="card-actions"><Link className="button button--soft" to={instructorPaths.curriculumManage(item.curriculumId)}>관리</Link></div>}
              </div>
            </article>
          ))}
        </div>
        {isInstructor && instructorListQuery.data && instructorListQuery.data.totalPages > 1 && <div className="pagination"><button type="button" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}>이전</button><span>{page + 1} / {instructorListQuery.data.totalPages}</span><button type="button" disabled={!instructorListQuery.data.hasNext} onClick={() => setPage((current) => current + 1)}>다음</button></div>}
      </Panel>

      {/*
        대기 0건이 학생의 평상시 상태다 — 그때 "없습니다" 한 줄에 패널 한 장을 쓰지 않고 아예
        내보내지 않는다. 신청하면 그 자리에 패널이 나타나므로, 필요한 순간에만 보인다.
      */}
      {!isInstructor && pendingStudentCurriculums.length > 0 && (
        <Panel title="승인 대기 중인 커리큘럼" description="강사가 수강 신청을 승인하면 나의 학습 목록에서 바로 시작할 수 있어요.">
          <div className="dashboard-curriculum-list">{pendingStudentCurriculums.map((item) => <PendingCurriculumCard key={item.curriculumId} item={item} />)}</div>
        </Panel>
      )}
    </div>
  )
}
