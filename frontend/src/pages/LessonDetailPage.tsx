import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { instructorPaths, publicPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { LiveReminderSetting } from '@/features/notification/LiveReminderSetting'
import { LESSON_MATERIALS_ANCHOR } from '@/features/lesson/lessonRouting'
import { getLesson } from '@/features/lesson/lessonService'
import LessonBreadcrumbs from '@/features/lesson/LessonBreadcrumbs'
import { isLiveEntryOpen } from '@/features/live-session/liveEntry'
import { getLiveSession } from '@/features/live-session/liveSessionService'
import { usePageTitle } from '@/shared/lib/usePageTitle'
import PageState from '@/shared/ui/PageState'
import { InlineNotice, PageHeader, Panel, StatusBadge } from '@/shared/ui/WorkspaceUi'

function formatScheduleTime(date: Date) {
  const period = date.getHours() < 12 ? '오전' : '오후'
  const hours = date.getHours() % 12 || 12
  const minutes = String(date.getMinutes()).padStart(2, '0')
  return `${period} ${hours}:${minutes}`
}

export default function LessonDetailPage() {
  const { curriculumId = '', sectionId = '', lessonId = '' } = useParams()
  const { user } = useAuth()
  const [entryNotice, setEntryNotice] = useState('')
  const isInstructor = user?.role === 'INSTRUCTOR'
  const lessonQuery = useQuery({
    queryKey: ['lesson', lessonId, user?.role, user?.userId, curriculumId, sectionId],
    queryFn: () => getLesson({ lessonId, role: user?.role, userId: user?.userId, curriculumId, sectionId }),
    enabled: Boolean(lessonId),
  })
  const liveSessionQuery = useQuery({
    queryKey: ['live-session', lessonQuery.data?.liveSession?.sessionId],
    queryFn: () => getLiveSession(lessonQuery.data!.liveSession!.sessionId),
    enabled: Boolean(lessonQuery.data?.liveSession?.sessionId),
  })
  const lesson = lessonQuery.data
  const liveSession = liveSessionQuery.data ?? null
  usePageTitle(lesson?.title ?? '강의 상세')

  if (!lessonId || !curriculumId || !sectionId) {
    return <PageState title="잘못된 강의 경로입니다" description="강의 식별자를 확인해 주세요." />
  }
  if (lessonQuery.isPending || (lesson?.liveSession && liveSessionQuery.isPending)) {
    return <PageState title="강의를 불러오는 중입니다" description="잠시만 기다려 주세요." />
  }
  if (lessonQuery.isError || liveSessionQuery.isError || !lesson) {
    return <PageState title="강의를 불러오지 못했습니다" description="잠시 후 다시 시도해 주세요." />
  }
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
  const readinessSummary = isInstructor ? (
    <ul className="lesson-readiness-summary" aria-label="강의 준비 상태">
      <li><span>강의 자료</span><strong>{lesson.materials.length}개 준비</strong></li>
      <li><span>AI 준비</span><strong>READY</strong></li>
      <li className={materialWorkInProgress ? 'is-warning' : undefined}><span>자료 작업</span><strong>{materialWorkInProgress ? '진행 중' : '완료'}</strong></li>
    </ul>
  ) : null

  return (
    <div className="workspace-page lesson-detail-page">
      <LessonBreadcrumbs
        curriculumPath={curriculumPath}
        curriculumTitle={lesson.curriculumTitle}
        lessonTitle={lesson.title}
        sectionTitle={lesson.sectionTitle}
      />
      <PageHeader
        title={lesson.title}
        // 게시·게시취소 버튼과 상태 배지는 없다 — 레슨 상태가 하나뿐이고 공개는 커리큘럼이 결정한다(ADR-0005).
        action={isInstructor ? <div className="header-action-group"><Link className="button button--primary" to={editLessonPath}>강의 수정</Link></div> : undefined}
      />
      <div className="lesson-detail-grid">
        <Panel className="lesson-detail__info" title="강의 정보">
          <div className="lesson-detail__info-content">
            <div className="lesson-detail__description">
              <span>강의 설명</span>
              <p>{lesson.description || '등록된 강의 설명이 없습니다.'}</p>
            </div>
            <dl className="lesson-detail__context">
              <div><dt>커리큘럼</dt><dd><Link to={curriculumPath}>{lesson.curriculumTitle}</Link></dd></div>
              <div><dt>섹션</dt><dd>{lesson.sectionTitle}</dd></div>
            </dl>
          </div>
        </Panel>

        {/*
          강의별 덮어쓰기. 커리큘럼 설정을 그대로 쓰는 사람에게도 보여 준다 — 그래야 "이 강의만
          다르게"가 가능하다는 것을 알 수 있다.
        */}
        <Panel className="lesson-detail__reminder" title="알림">
          <LiveReminderSetting curriculumId={curriculumId} lessonId={lessonId} />
        </Panel>

        {!showReplay ? (
          <Panel
            className="lesson-detail__primary"
            title="라이브 강의"
            description="일정과 현재 상태를 확인하고 바로 점검을 시작합니다."
            action={liveSession ? <StatusBadge tone={liveStatusLabel === '입장 가능' ? 'live' : 'warning'}>{liveStatusLabel}</StatusBadge> : undefined}
          >
            {liveSession && scheduledDate && entryDate ? <>
              <div className="lesson-live-summary">
                <div className="lesson-live-date"><span>{scheduledDate.getMonth() + 1}월</span><strong>{String(scheduledDate.getDate()).padStart(2, '0')}</strong></div>
                <section className="lesson-live-schedule" aria-labelledby="lesson-live-schedule-heading">
                  <h3 id="lesson-live-schedule-heading">라이브 일정</h3>
                  <dl><div><dt>시작</dt><dd>{formatScheduleTime(scheduledDate)}</dd></div><div><dt>입장</dt><dd>{formatScheduleTime(entryDate)}부터</dd></div><div><dt>예상</dt><dd>{liveSession.expectedDurationMinutes}분</dd></div></dl>
                </section>
                <section className="lesson-live-state" aria-label="현재 상태">
                  <strong>{liveStatusLabel === '입장 가능' ? '라이브 강의를 시작할 수 있어요' : '라이브 시작을 기다리고 있어요'}</strong>
                  <p>{isInstructor ? '사전 점검을 완료하면 강의를 시작할 수 있습니다.' : '입장 전 점검을 마친 뒤 강사의 시작을 기다려 주세요.'}</p>
                  {isInstructor
                    ? <Link className="button button--primary lesson-live-cta" to={instructorPaths.preflight(liveSession.sessionId)}>사전 점검 시작 <span aria-hidden="true">→</span></Link>
                    : canEnterLive
                      ? <Link className="button button--primary lesson-live-cta" to={studentPaths.prejoin(liveSession.sessionId)}>입장 점검 시작 <span aria-hidden="true">→</span></Link>
                      : <button className="button lesson-live-cta is-pending" type="button" onClick={() => setEntryNotice('강의 시간이 아닙니다.')}>입장 점검 시작 <span aria-hidden="true">→</span></button>}
                </section>
              </div>
              {readinessSummary && <div className="lesson-detail__primary-footer">{readinessSummary}</div>}
            </> : <>
              {isInstructor ? <div className="empty-live-state"><InlineNotice tone="warning">연결된 라이브 일정이 없습니다. 강의 수정에서 라이브 강의 일정을 추가해 주세요.</InlineNotice><Link className="button button--primary" to={editLessonPath}>강의 수정에서 일정 추가</Link></div> : <InlineNotice>연결된 라이브 일정이 아직 없습니다.</InlineNotice>}
              {readinessSummary && <div className="lesson-detail__primary-footer">{readinessSummary}</div>}
            </>}
            {entryNotice && <InlineNotice tone="warning">{entryNotice}</InlineNotice>}
          </Panel>
        ) : (
          <Panel className="lesson-detail__primary" title="다시보기" description={isInstructor ? '녹화 영상과 수강생 공개 상태를 확인합니다.' : undefined}>
            {isInstructor ? <div className="replay-summary lesson-replay-summary"><div><StatusBadge tone="success">VIDEO READY</StatusBadge><StatusBadge tone="warning">REVIEW</StatusBadge><h3>녹화 영상 검수 가능</h3><p>교정 자막과 퀴즈는 검수 중이며 영상은 독립적으로 게시할 수 있습니다.</p></div><Link className="button button--primary" to={replayPath}>미리보기·검수</Link></div> : <div className="student-replay-summary"><div><span>진행도</span><strong>{replayProgress}%</strong></div>{canReplay ? <Link className="button button--primary" to={replayPath}>다시보기</Link> : <span className="replay-pending-label">다시 보기 준비 중</span>}</div>}
            {readinessSummary && <div className="lesson-detail__primary-footer">{readinessSummary}</div>}
          </Panel>
        )}

        {/* 자료 전용 화면이 없어 자료 등록 알림이 이 영역을 직접 가리킨다(LESSON_MATERIALS_ANCHOR). */}
        <Panel id={LESSON_MATERIALS_ANCHOR} className="lesson-detail__materials" title="강의 자료" description="수강생에게 공개되는 PPTX 원본입니다." action={<StatusBadge>{lesson.materials.length}개</StatusBadge>}>
          {lesson.materials.length > 0
            ? <ul className="material-list material-list--compact">{lesson.materials.map((material) => <li key={material.id}><span className="file-icon">PPTX</span><div><strong>{material.name}</strong><small>{material.size}</small></div><button className="text-button" type="button">다운로드</button></li>)}</ul>
            : <p className="lesson-detail__material-empty">등록된 강의 자료가 없습니다.</p>}
        </Panel>
      </div>
    </div>
  )
}
