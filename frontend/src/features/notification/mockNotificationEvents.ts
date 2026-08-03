import {
  findMockLesson,
  findMockLiveSession,
  findMockSection,
  getMockCurriculum,
  type MockCurriculumEntity,
} from '@/features/demo/mockDatabase'
import {
  getMockEnrollmentById,
  getMockEnrollmentsByCurriculum,
  getMockStudentContact,
} from '@/features/enrollment/mockEnrollmentStore'
import { notificationMessage, notificationTitle } from './mockNotificationCopy'
import {
  appendMockNotification,
  completeMockNotificationsFor,
  type MockNotificationRecord,
} from './mockNotificationStore'
import type { NotificationScheduleChange, NotificationType } from './types'

/**
 * 알림 발행 진입점.
 *
 * <p><b>왜 도메인 mock 서비스가 여기를 호출하는가</b>: 알림은 "수강 신청됨"·"녹화 완료됨"처럼
 * 다른 도메인에서 일어난 사건의 결과다. 알림 저장소가 남의 도메인을 폴링할 수는 없고, 반대로
 * 도메인 서비스가 알림 저장소의 내부(중복 키·문구·수신자 판정)를 알아서도 안 된다. 그래서 사건
 * 이름으로 된 함수만 노출하고, 수신자·권한·문구·중복 방지는 전부 이 안에서 끝낸다.
 *
 * <p>실제 서버에서는 이 파일에 해당하는 로직이 도메인 이벤트 핸들러(또는 outbox consumer)로
 * 들어간다. 프론트 화면은 어느 쪽에서도 이 모듈을 직접 부르지 않는다.
 */

function now() {
  return new Date().toISOString()
}

/**
 * 이 커리큘럼의 알림을 받을 학생. <b>ACTIVE(수강 승인)만</b> 받는다 — 거절·취소·제적된 학생에게
 * 이후 강의·라이브·다시보기 알림이 가면 안 된다(요구사항 §10).
 */
function approvedStudentIds(curriculumId: string) {
  return getMockEnrollmentsByCurriculum(curriculumId)
    .filter((enrollment) => enrollment.status === 'ACTIVE')
    .map((enrollment) => enrollment.userId)
}

/** 커리큘럼의 담당 강사. 강사 계정이라는 이유만으로는 남의 커리큘럼 알림을 받지 못한다. */
function ownerInstructorId(curriculum: MockCurriculumEntity) {
  return curriculum.instructor.instructorId
}

/** 학생에게 공개된 커리큘럼인가. 초안 상태에서는 학생 알림을 만들지 않는다(요구사항 §7). */
function isVisibleToStudents(curriculum: MockCurriculumEntity) {
  return curriculum.lifecycleStatus === 'PUBLISHED'
}

interface LessonEventContext {
  curriculum: MockCurriculumEntity
  sectionId: string
  lessonId: string
  lessonTitle: string
  liveSessionId: string | null
  scheduledAt: string | null
}

function lessonContext(lessonId: string): LessonEventContext | null {
  const found = findMockLesson(lessonId)
  if (!found) return null
  return {
    curriculum: found.curriculum,
    sectionId: found.section.sectionId,
    lessonId: found.lesson.lessonId,
    lessonTitle: found.lesson.title,
    liveSessionId: found.lesson.liveSession?.sessionId ?? null,
    scheduledAt: found.lesson.scheduledAt,
  }
}

interface StudentFanoutInput {
  type: NotificationType
  context: LessonEventContext
  createdAt: string
  scheduleChange?: NotificationScheduleChange | null
  /** 중복 방지 키의 리소스 부분. 기본은 강의 id — 일정 변경처럼 반복되는 사건은 직접 넘긴다. */
  dedupeResource?: string
  materialId?: string
}

function fanoutToStudents(input: StudentFanoutInput): MockNotificationRecord[] {
  const { context } = input
  if (!isVisibleToStudents(context.curriculum)) return []
  return approvedStudentIds(context.curriculum.curriculumId).map((studentId) =>
    appendMockNotification({
      recipientId: studentId,
      type: input.type,
      title: notificationTitle(input.type),
      message: notificationMessage(input.type, {
        curriculumTitle: context.curriculum.title,
        lessonTitle: context.lessonTitle,
        scheduledAt: context.scheduledAt,
        scheduleChange: input.scheduleChange ?? null,
      }),
      targets: {
        curriculumId: context.curriculum.curriculumId,
        sectionId: context.sectionId,
        lessonId: context.lessonId,
        ...(context.liveSessionId ? { liveSessionId: context.liveSessionId } : {}),
        ...(input.materialId ? { materialId: input.materialId } : {}),
        actorId: ownerInstructorId(context.curriculum),
      },
      dedupeResource: input.dedupeResource ?? context.lessonId,
      createdAt: input.createdAt,
      scheduleChange: input.scheduleChange ?? null,
    }),
  )
}

/* ---------------------------------------------------------------- 수강 신청 */

/** 학생이 수강 신청했다 → 담당 강사에게 확인이 필요한 알림. */
export function publishEnrollmentRequested(enrollmentId: string, createdAt = now()) {
  const enrollment = getMockEnrollmentById(enrollmentId)
  if (!enrollment) return null
  const curriculum = getMockCurriculum(enrollment.curriculumId)
  if (!curriculum) return null
  const contact = getMockStudentContact(enrollment.userId)

  return appendMockNotification({
    recipientId: ownerInstructorId(curriculum),
    type: 'ENROLLMENT_REQUESTED',
    title: notificationTitle('ENROLLMENT_REQUESTED'),
    message: notificationMessage('ENROLLMENT_REQUESTED', {
      studentName: contact?.displayName,
      curriculumTitle: curriculum.title,
    }),
    targets: {
      curriculumId: curriculum.curriculumId,
      enrollmentId: enrollment.enrollmentId,
      studentId: enrollment.userId,
      actorId: enrollment.userId,
    },
    dedupeResource: enrollment.enrollmentId,
    createdAt,
  })
}

/**
 * 강사가 승인·거절했다 → 학생에게 결과 알림 + 강사의 "처리 대기" 알림을 처리 완료로 내린다.
 *
 * <p>읽음 처리와 <b>따로</b> 움직인다: 강사가 알림을 읽기만 했을 때는 여기까지 오지 않으므로
 * `ACTION_REQUIRED`가 유지된다.
 */
export function publishEnrollmentDecided(
  enrollmentId: string,
  decision: 'APPROVED' | 'REJECTED',
  createdAt = now(),
) {
  const enrollment = getMockEnrollmentById(enrollmentId)
  if (!enrollment) return null
  const curriculum = getMockCurriculum(enrollment.curriculumId)
  if (!curriculum) return null

  completeMockNotificationsFor(
    { type: 'ENROLLMENT_REQUESTED', targets: { enrollmentId } },
    'COMPLETED',
    createdAt,
  )

  const type: NotificationType = decision === 'APPROVED' ? 'ENROLLMENT_APPROVED' : 'ENROLLMENT_REJECTED'
  return appendMockNotification({
    recipientId: enrollment.userId,
    type,
    title: notificationTitle(type),
    message: notificationMessage(type, { curriculumTitle: curriculum.title }),
    targets: {
      curriculumId: curriculum.curriculumId,
      enrollmentId: enrollment.enrollmentId,
      actorId: ownerInstructorId(curriculum),
    },
    dedupeResource: enrollment.enrollmentId,
    createdAt,
  })
}

/**
 * 학생이 신청을 스스로 취소했다 → 강사의 "처리 대기" 알림을 더 처리할 수 없는 상태로 내린다.
 * 새 알림을 만들지 않는다: 취소는 강사가 처리해야 할 일이 아니라 사라진 일이다.
 */
export function expireEnrollmentRequest(enrollmentId: string, at = now()) {
  return completeMockNotificationsFor(
    { type: 'ENROLLMENT_REQUESTED', targets: { enrollmentId } },
    'EXPIRED',
    at,
  )
}

/* ------------------------------------------------------------ 강의·자료 공개 */

/** 이미 목차에 있는 강의가 학생에게 공개됐다 → 수강 승인 학생에게 공개 알림. */
export function publishLessonPublished(lessonId: string, createdAt = now()) {
  const context = lessonContext(lessonId)
  if (!context) return []
  return fanoutToStudents({ type: 'LESSON_PUBLISHED', context, createdAt })
}

/**
 * 강의를 새로 만들었다 → 수강 승인 학생에게 공개 알림.
 *
 * <p>`publishLessonPublished`와 나눠 둔 이유: 방금 만든 강의는 아직 목차에서 찾을 수 없어
 * (mock 목차는 seed에서 파생된다) 제목·커리큘럼을 강의 id로 역추적할 수 없다. 대신 저장 요청이
 * 갖고 있는 섹션 id와 제목을 받아 커리큘럼을 찾는다.
 */
export function publishLessonCreated(
  input: { sectionId: string; lessonId: string; lessonTitle: string; scheduledAt: string | null },
  createdAt = now(),
) {
  const found = findMockSection(input.sectionId)
  if (!found) return []
  return fanoutToStudents({
    type: 'LESSON_PUBLISHED',
    context: {
      curriculum: found.curriculum,
      sectionId: input.sectionId,
      lessonId: input.lessonId,
      lessonTitle: input.lessonTitle,
      liveSessionId: null,
      scheduledAt: input.scheduledAt,
    },
    createdAt,
  })
}

/**
 * 이미 있는 강의에 학습 자료가 새로 올라갔다 → 수강 승인 학생에게 자료 알림.
 * 강의를 새로 만들면서 함께 올린 자료는 여기로 오지 않는다 — `LESSON_PUBLISHED` 하나로 충분하고,
 * 같은 사건을 두 줄로 알리면 알림 목록이 스스로를 반복한다(요구사항 §13).
 */
export function publishMaterialPublished(lessonId: string, materialId: string, createdAt = now()) {
  const context = lessonContext(lessonId)
  if (!context) return []
  return fanoutToStudents({
    type: 'MATERIAL_PUBLISHED',
    context,
    createdAt,
    materialId,
    dedupeResource: `${context.lessonId}:${materialId}`,
  })
}

/* ---------------------------------------------------------------- 라이브 일정 */

/** 기존 강의에 라이브 일정이 새로 붙었다. */
export function publishLiveScheduled(lessonId: string, scheduledAt: string, createdAt = now()) {
  const context = lessonContext(lessonId)
  if (!context) return []
  return fanoutToStudents({
    type: 'LIVE_SCHEDULED',
    context: { ...context, scheduledAt },
    createdAt,
    dedupeResource: `${context.lessonId}:${scheduledAt}`,
  })
}

/** 라이브 시작 시각이 바뀌었다. 변경 전·후를 함께 담아야 알림이 쓸모가 있다. */
export function publishLiveScheduleChanged(
  lessonId: string,
  change: NotificationScheduleChange,
  createdAt = now(),
) {
  const context = lessonContext(lessonId)
  if (!context) return []
  return fanoutToStudents({
    type: 'LIVE_SCHEDULE_CHANGED',
    context: { ...context, scheduledAt: change.nextStartsAt },
    createdAt,
    scheduleChange: change,
    // 같은 강의를 여러 번 옮기면 각각 알린다 — 새 시각까지 키에 넣어야 두 번째 변경이 묻히지 않는다.
    dedupeResource: `${context.lessonId}:${change.nextStartsAt}`,
  })
}

/**
 * 강의가 삭제돼 예정된 라이브가 사라졌다.
 *
 * <p>강의를 지우면 `findMockLesson`이 더 이상 찾지 못하므로 <b>삭제 전에</b> 불러야 한다.
 * 호출 순서에 의존하는 것이 불편하지만, 사라진 대상의 제목·수강생을 삭제 후에 알 방법이 없다.
 */
export function publishLiveCanceled(lessonId: string, createdAt = now()) {
  const context = lessonContext(lessonId)
  if (!context || !context.liveSessionId) return []
  return fanoutToStudents({
    type: 'LIVE_CANCELED',
    context,
    createdAt,
    dedupeResource: context.liveSessionId,
  })
}

/**
 * 오늘·직전 라이브 안내. 사람의 행동이 아니라 <b>시각</b>이 방아쇠라서 실제 서버에서는 예약 작업이
 * 만든다. mock에는 그 예약 작업이 없으므로 seed가 같은 모양의 알림을 심어 화면·이동을 검증한다.
 */
export function publishLiveStartingSoon(
  recipientId: string,
  lessonId: string,
  createdAt = now(),
) {
  const context = lessonContext(lessonId)
  if (!context) return null
  return appendMockNotification({
    recipientId,
    type: 'LIVE_STARTING_SOON',
    title: notificationTitle('LIVE_STARTING_SOON'),
    message: notificationMessage('LIVE_STARTING_SOON', {
      lessonTitle: context.lessonTitle,
      scheduledAt: context.scheduledAt,
    }),
    targets: {
      curriculumId: context.curriculum.curriculumId,
      sectionId: context.sectionId,
      lessonId: context.lessonId,
      ...(context.liveSessionId ? { liveSessionId: context.liveSessionId } : {}),
    },
    // 하루에 한 번만. 같은 일정으로 몇 번 계산이 돌아도 한 건만 남는다.
    dedupeResource: `${context.lessonId}:${(context.scheduledAt ?? createdAt).slice(0, 10)}`,
    createdAt,
  })
}

/* --------------------------------------------------------- 녹화·다시보기 */

/**
 * 녹화 처리가 끝났다 → 강사에게 확인이 필요한 알림.
 *
 * <p>학생용 다시보기 알림은 여기서 만들지 않는다. 녹화 완료와 학생 공개는 별개의 사건이며,
 * 현재 서버가 둘을 같은 트랜잭션에서 처리하더라도 <b>공개된 사실</b>을 근거로
 * `publishVodPublished`가 따로 발행한다.
 */
export function publishRecordingReady(sessionId: string, createdAt = now()) {
  const found = findMockLiveSession(sessionId)
  if (!found) return null
  return appendMockNotification({
    recipientId: ownerInstructorId(found.curriculum),
    type: 'RECORDING_READY',
    title: notificationTitle('RECORDING_READY'),
    message: notificationMessage('RECORDING_READY', { lessonTitle: found.lesson.title }),
    targets: {
      curriculumId: found.curriculum.curriculumId,
      sectionId: found.section.sectionId,
      lessonId: found.lesson.lessonId,
      liveSessionId: sessionId,
      recordingId: `vid-${sessionId}`,
    },
    dedupeResource: sessionId,
    createdAt,
  })
}

/** 녹화 생성·변환·저장이 실패했다 → 강사에게 오류 알림. 실패 코드는 문구에 넣지 않는다. */
export function publishRecordingFailed(sessionId: string, createdAt = now()) {
  const found = findMockLiveSession(sessionId)
  if (!found) return null
  return appendMockNotification({
    recipientId: ownerInstructorId(found.curriculum),
    type: 'RECORDING_FAILED',
    title: notificationTitle('RECORDING_FAILED'),
    message: notificationMessage('RECORDING_FAILED', { lessonTitle: found.lesson.title }),
    targets: {
      curriculumId: found.curriculum.curriculumId,
      sectionId: found.section.sectionId,
      lessonId: found.lesson.lessonId,
      liveSessionId: sessionId,
    },
    dedupeResource: sessionId,
    createdAt,
  })
}

/** 강사가 녹화본을 확인했다(검수 화면 진입 또는 게시) → 녹화 알림을 처리 완료로 내린다. */
export function completeRecordingReview(lessonId: string, at = now()) {
  const completed = completeMockNotificationsFor(
    { type: 'RECORDING_READY', targets: { lessonId } },
    'COMPLETED',
    at,
  )
  return [
    ...completed,
    ...completeMockNotificationsFor(
      { type: 'RECORDING_FAILED', targets: { lessonId } },
      'COMPLETED',
      at,
    ),
  ]
}

/** 다시보기가 실제로 학생에게 공개됐다 → 수강 승인 학생에게 알림. */
export function publishVodPublished(lessonId: string, createdAt = now()) {
  const context = lessonContext(lessonId)
  if (!context) return []
  return fanoutToStudents({ type: 'VOD_PUBLISHED', context, createdAt })
}
