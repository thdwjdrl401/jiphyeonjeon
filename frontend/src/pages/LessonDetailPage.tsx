import { useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { instructorPaths, publicPaths, studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import LiveReminderPopover from '@/features/notification/LiveReminderPopover'
import GlossaryReviewModal from '@/features/lesson/GlossaryReviewModal'
import { LESSON_MATERIALS_ANCHOR } from '@/features/lesson/lessonRouting'
import { getLesson } from '@/features/lesson/lessonService'
import type { LessonMaterialView } from '@/features/lesson/lessonService.interface'
import LessonBreadcrumbs from '@/features/lesson/LessonBreadcrumbs'
import { isLiveEntryOpen } from '@/features/live-session/liveEntry'
import { getLiveSession, getProcessingStatus } from '@/features/live-session/liveSessionService'
import { describeReplayBadge, processingPollInterval } from '@/features/live-session/liveSessionProcessing'
import type { MaterialDownloadRequest } from '@/features/material/materialDownloadService'
import MaterialStatusBadges from '@/features/material/MaterialStatusBadges'
import {
  hasMaterialInProgress,
  isMaterialInProgress,
  materialEmbeddingState,
  materialRefetchInterval,
} from '@/features/material/materialStatus'
import { useMaterialDownload } from '@/features/material/useMaterialDownload'
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
  const [glossaryReviewOpen, setGlossaryReviewOpen] = useState(false)
  const { download: downloadMaterial, downloadingMaterialId } = useMaterialDownload()
  const isInstructor = user?.role === 'INSTRUCTOR'
  const lessonQuery = useQuery({
    queryKey: ['lesson', lessonId, user?.role, user?.userId, curriculumId, sectionId],
    queryFn: () => getLesson({ lessonId, role: user?.role, userId: user?.userId, curriculumId, sectionId }),
    enabled: Boolean(lessonId),
    // 자료를 올린 직후 이 화면으로 돌아오면 임베딩이 아직 돌고 있다. 폴링이 없으면 새로고침
    // 전까지 "AI 준비 중"에 멈춰 있어, 실제로 끝났는지 실패했는지 알 방법이 없었다(ADR-0036).
    refetchInterval: (query) => materialRefetchInterval(query.state.data?.materials),
    refetchIntervalInBackground: false,
  })
  const liveSessionQuery = useQuery({
    queryKey: ['live-session', lessonQuery.data?.liveSession?.sessionId],
    queryFn: () => getLiveSession(lessonQuery.data!.liveSession!.sessionId),
    enabled: Boolean(lessonQuery.data?.liveSession?.sessionId),
  })
  /*
   * 녹화 처리 현황. [ADR-0092]가 종료 동선을 이 화면으로 바꾸면서 "상세가 이미 준비 상태를 보여
   * 준다"를 전제했는데, 실제로는 "VIDEO READY"가 문자열로 박혀 있었다 — 인코딩 중이든 실패했든
   * 강사에게는 늘 검수 가능으로 보였고, 눌러 들어가면 재생이 안 됐다.
   *
   * <p>폴링은 [ADR-0007] 정책을 그대로 쓴다. READY·FAILED·"녹화 안 함" 중 하나에 닿으면
   * processingPollInterval이 false를 돌려주어 <b>스스로 멈춘다</b> — 성공만 보고 멈추면 실패한
   * 녹화가 영원히 서버를 두드린다.
   */
  const endedSessionId = lessonQuery.data?.liveSession
    && (lessonQuery.data.liveSession.status === 'ENDING' || lessonQuery.data.liveSession.status === 'ENDED')
    ? lessonQuery.data.liveSession.sessionId
    : undefined
  const processingMountedAt = useRef(Date.now())
  const processingQuery = useQuery({
    queryKey: ['live-session-processing', endedSessionId],
    queryFn: () => getProcessingStatus(endedSessionId!),
    enabled: isInstructor && Boolean(endedSessionId),
    refetchInterval: (query) => processingPollInterval(
      query.state.data,
      Date.now() - processingMountedAt.current,
    ),
    refetchIntervalInBackground: false,
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
  const processingPath = endedSessionId ? instructorPaths.processing(endedSessionId) : replayPath
  // 배지는 강사에게만. 수강생은 아래 진행도·"준비 중" 라벨로 이미 필요한 것을 본다.
  const replayBadge = isInstructor
    ? describeReplayBadge(processingQuery.data, processingQuery.isPending && Boolean(endedSessionId))
    : null
  const canEnterLive = lesson.liveSession ? isLiveEntryOpen(lesson.liveSession) : false
  const canReplay = lesson.replayStatus === 'PUBLISHED'
  const replayProgress = lesson.learning?.progressPercent ?? 0
  const materialWorkInProgress = hasMaterialInProgress(lesson.materials)
  // 커리큘럼 자료와 같은 규칙 — 강사는 관리용 경로, 수강생은 수강 관계로 열리는 경로.
  const materialDownloadRequest = (material: LessonMaterialView): MaterialDownloadRequest => ({
    scope: 'LESSON',
    parentId: lessonId,
    materialId: material.id,
    fileName: material.name,
    asInstructor: isInstructor,
  })
  const scheduledDate = liveSession?.scheduledAt ? new Date(liveSession.scheduledAt) : null
  const entryDate = scheduledDate ? new Date(scheduledDate.getTime() - 10 * 60_000) : null
  const liveStatusLabel = liveSession && ['OPEN', 'STARTING', 'LIVE'].includes(liveSession.status) ? '입장 가능' : '예정'
  // 세 칸 모두 자료의 실제 상태에서 나온다. 예전엔 "AI 준비"가 상수 READY였고 "자료 작업"은
  // status!=='READY'라 실패한 자료까지 "진행 중"으로 보였다 — 영원히 끝나지 않는 것처럼 읽혔다.
  const readyMaterialCount = lesson.materials
    .filter((material) => materialEmbeddingState(material) === 'READY' && !isMaterialInProgress(material))
    .length
  const materialFailed = lesson.materials.some((material) => materialEmbeddingState(material) === 'FAILED')
  const readinessSummary = isInstructor ? (
    <ul className="lesson-readiness-summary" aria-label="강의 준비 상태">
      <li><span>강의 자료</span><strong>{lesson.materials.length}개</strong></li>
      <li><span>AI 준비</span><strong>{lesson.materials.length > 0 ? `${readyMaterialCount}/${lesson.materials.length} 완료` : '자료 없음'}</strong></li>
      <li className={materialWorkInProgress || materialFailed ? 'is-warning' : undefined}>
        <span>자료 작업</span>
        <strong>{materialWorkInProgress ? '진행 중' : materialFailed ? '실패' : '완료'}</strong>
      </li>
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
        <Panel
          className="lesson-detail__info"
          title="강의 정보"
          action={<LiveReminderPopover curriculumId={curriculumId} lessonId={lessonId} placement="panel" />}
        >
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
            {isInstructor ? (
              <div className="replay-summary lesson-replay-summary">
                <div>
                  {replayBadge && (
                    <StatusBadge
                      tone={replayBadge.tone}
                      busy={replayBadge.busy}
                      to={replayBadge.goTo === 'processing' ? processingPath : undefined}
                    >{replayBadge.label}</StatusBadge>
                  )}
                  <h3>{replayBadge?.busy ? '녹화를 처리하고 있습니다' : '녹화 영상'}</h3>
                  <p>{replayBadge?.hint || '이 강의는 녹화하지 않았습니다.'}</p>
                </div>
                {/* 아직 볼 것이 없을 때 검수로 보내지 않는다 — 들어가 봐야 재생이 안 된다. */}
                {replayBadge && !replayBadge.busy && replayBadge.tone !== 'danger'
                  && <Link className="button button--primary" to={replayPath}>미리보기·검수</Link>}
              </div>
            ) : (
              <div className="student-replay-summary">
                <div className="student-replay-progress">
                  <div className="student-replay-progress__label"><span>진행도</span><strong>{replayProgress}%</strong></div>
                  <span
                    className="progress-track student-replay-progress__track"
                    role="progressbar"
                    aria-label="다시보기 학습 진행률"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={replayProgress}
                  >
                    <span style={{ width: `${replayProgress}%` }} />
                  </span>
                </div>
                {canReplay
                  ? <Link className="button button--primary" to={replayPath}>다시보기</Link>
                  : <span className="replay-pending-label">다시 보기 준비 중</span>}
              </div>
            )}
            {readinessSummary && <div className="lesson-detail__primary-footer">{readinessSummary}</div>}
          </Panel>
        )}

        {/* 자료 전용 화면이 없어 자료 등록 알림이 이 영역을 직접 가리킨다(LESSON_MATERIALS_ANCHOR). */}
        <Panel
          id={LESSON_MATERIALS_ANCHOR}
          className="lesson-detail__materials"
          title="강의 자료"
          description="수강생에게 공개되는 PPTX 원본입니다."
          action={<StatusBadge>{lesson.materials.length}개</StatusBadge>}
        >
          {lesson.materials.length > 0
            ? <ul className="material-list material-list--compact">{lesson.materials.map((material) => <li key={material.id}><span className="file-icon">PPTX</span><div><strong>{material.name}</strong><small>{material.size}</small></div><MaterialStatusBadges material={material} audience={isInstructor ? 'instructor' : 'student'} /><button className="text-button" type="button" disabled={downloadingMaterialId === material.id} aria-label={`${material.name} 다운로드`} onClick={() => void downloadMaterial(materialDownloadRequest(material))}>{downloadingMaterialId === material.id ? '받는 중…' : '다운로드'}</button></li>)}</ul>
            : <p className="lesson-detail__material-empty">등록된 강의 자료가 없습니다.</p>}
          {/* 자료 목록과 별개의 flex 자식이라 목록 스크롤과 무관하게 항상 패널 하단에 고정된다. */}
          {isInstructor && (
            <div className="lesson-detail__materials-footer">
              <button className="text-button" type="button" onClick={() => setGlossaryReviewOpen(true)}>핵심 단어 검수</button>
            </div>
          )}
        </Panel>
      </div>

      {glossaryReviewOpen && (
        <GlossaryReviewModal lessonId={lessonId} lessonTitle={lesson.title} onClose={() => setGlossaryReviewOpen(false)} />
      )}
    </div>
  )
}
