import { getMockEnrollment, getMockEnrollments } from '@/features/enrollment/mockEnrollmentStore'
import {
  buildMockCurriculumOutline,
  findLastRecordedLesson,
  findMockLesson,
  findMockLiveSession,
  findNextLiveLesson,
  getMockCurriculum,
  getMockProgress,
  mockCurriculumEntities,
} from './mockDatabase'

const primaryCurriculum = getMockCurriculum('cur-spring-live')!
const primaryLessonContext = findMockLesson('les-security')!
const primarySessionContext = findMockLiveSession('ses-security-live')!

export const demoCurriculum = {
  curriculumId: primaryCurriculum.curriculumId,
  title: primaryCurriculum.title,
  summary: primaryCurriculum.summary,
  description: primaryCurriculum.description,
  lifecycleStatus: primaryCurriculum.lifecycleStatus,
  startsAt: primaryCurriculum.period?.startsAt ?? '',
  endsAt: primaryCurriculum.period?.endsAt ?? '',
  instructor: primaryCurriculum.instructor.displayName,
  enrolleeCount: primaryCurriculum.enrolleeCount,
  thumbnailUrl: primaryCurriculum.thumbnailUrl,
}

export const demoSections = buildMockCurriculumOutline(primaryCurriculum).map((section) => ({
  sectionId: section.sectionId,
  title: section.title,
  description: section.description ?? '',
  lessons: section.lessons.map((lesson) => ({
    lessonId: lesson.lessonId,
    title: lesson.title,
    status: lesson.status,
  })),
}))

export function getDemoCurriculumLessonNavigation(curriculumId: string) {
  const curriculum = getMockCurriculum(curriculumId) ?? primaryCurriculum
  return {
    curriculumId: curriculum.curriculumId,
    title: curriculum.title,
    sections: buildMockCurriculumOutline(curriculum).map((section) => ({
      sectionId: section.sectionId,
      title: section.title,
      lessons: section.lessons.map((lesson) => ({
        lessonId: lesson.lessonId,
        title: lesson.title,
        order: lesson.order,
      })),
    })),
  }
}

export const demoLesson = {
  lessonId: primaryLessonContext.lesson.lessonId,
  title: primaryLessonContext.lesson.title,
  description: '인증 필터와 세션의 흐름을 실제 요청을 따라가며 이해합니다.',
  status: primaryLessonContext.lesson.status,
  sectionTitle: primaryLessonContext.section.title,
  materials: [
    { id: 'mat-security', name: 'spring-security-basics.pptx', size: '3.4 MB', status: 'READY' },
    { id: 'mat-session', name: 'session-and-csrf.pptx', size: '2.1 MB', status: 'READY' },
  ],
}

export const demoSession = {
  sessionId: primarySessionContext.liveSession.sessionId,
  lessonId: primarySessionContext.lesson.lessonId,
  status: primarySessionContext.liveSession.status,
  scheduledAt: primarySessionContext.liveSession.scheduledAt,
  entryOpensAt: '2026-08-01T09:50:00+09:00',
  expectedDurationMinutes: 90,
  participants: 128,
}

export function getDemoLesson(lessonId: string, userId?: string) {
  const context = findMockLesson(lessonId) ?? primaryLessonContext
  const isPrimaryLesson = context.lesson.lessonId === demoLesson.lessonId
  const enrollment = userId ? getMockEnrollment(userId, context.curriculum.curriculumId) : null
  const isCompleted = Boolean(enrollment && context.lesson.order <= enrollment.completedLessonCount)
  const isCurrentLesson = enrollment?.lastLessonId === context.lesson.lessonId
  const progressPercent = isCompleted
    ? 100
    : isCurrentLesson && context.lesson.durationMs
      ? Math.min(99, Math.round((enrollment.sessionMs / context.lesson.durationMs) * 100))
      : 0
  return {
    lessonId: context.lesson.lessonId,
    title: context.lesson.title,
    description: isPrimaryLesson
      ? demoLesson.description
      : `${context.lesson.title}의 핵심 개념과 실습 내용을 학습합니다.`,
    status: context.lesson.status,
    sectionId: context.section.sectionId,
    sectionTitle: context.section.title,
    curriculumId: context.curriculum.curriculumId,
    curriculumTitle: context.curriculum.title,
    materials: isPrimaryLesson
      ? demoLesson.materials
      : [{ id: `mat-${context.lesson.lessonId}`, name: `${context.lesson.lessonId}.pptx`, size: '2.4 MB', status: 'READY' }],
    liveSession: context.lesson.liveSession,
    replayStatus: context.lesson.replayStatus,
    learning: enrollment?.status === 'ACTIVE' ? { completed: isCompleted, progressPercent } : null,
  }
}

export function getDemoLiveSession(sessionId: string) {
  const context = findMockLiveSession(sessionId) ?? primarySessionContext
  return {
    sessionId: context.liveSession.sessionId,
    lessonId: context.lesson.lessonId,
    lessonTitle: context.lesson.title,
    curriculumId: context.curriculum.curriculumId,
    curriculumTitle: context.curriculum.title,
    sectionId: context.section.sectionId,
    status: context.liveSession.status,
    scheduledAt: context.liveSession.scheduledAt,
    entryOpensAt: context.liveSession.scheduledAt,
    expectedDurationMinutes: 90,
    participants: context.liveSession.status === 'LIVE' ? 128 : 0,
  }
}

export const demoMessages = [
  { id: 'msg-1', alias: '수강생-14A2', text: '세션과 JWT를 함께 쓰는 경우도 있나요?', time: '10:14', question: true },
  { id: 'msg-2', alias: '수강생-09C1', text: '필터 순서가 왜 중요한지 이해됐어요.', time: '10:16', question: false },
  { id: 'msg-3', alias: '이도현 강사', text: '좋은 질문이에요. 다음 예제에서 바로 비교해 볼게요.', time: '10:17', question: false },
]

export const demoLiveCaptions = [
  {
    segmentId: 'caption-live-1',
    startMs: 728_000,
    endMs: 743_000,
    at: '12:08',
    text: '인증이 끝난 뒤에는 SecurityContext가 현재 요청의 사용자 정보를 보관합니다.',
    termReferences: [{ termId: 'term-security-context', startIndex: 11, endIndex: 26 }],
  },
  {
    segmentId: 'caption-live-2',
    startMs: 744_000,
    endMs: 760_000,
    at: '12:24',
    text: '이 경계를 SecurityFilterChain의 권한 검사와 함께 보겠습니다.',
    termReferences: [{ termId: 'term-security-filter-chain', startIndex: 6, endIndex: 25 }],
  },
  {
    segmentId: 'caption-live-3',
    startMs: 761_000,
    endMs: 779_000,
    at: '12:41',
    text: '세션 저장소를 Redis로 분리하면 여러 서버가 같은 인증 상태를 공유할 수 있습니다.',
    termReferences: [{ termId: 'term-redis', startIndex: 8, endIndex: 13 }],
  },
]

export const demoReplayCaptions = [
  ...demoLiveCaptions,
  {
    segmentId: 'caption-replay-4',
    startMs: 1_880_000,
    endMs: 1_899_000,
    at: '31:20',
    text: 'Redis 세션은 여러 애플리케이션 인스턴스가 인증 상태를 공유하게 해줍니다.',
    termReferences: [{ termId: 'term-redis', startIndex: 0, endIndex: 5 }],
  },
  {
    segmentId: 'caption-replay-5',
    startMs: 3_522_000,
    endMs: 3_540_000,
    at: '58:42',
    text: 'CSRF 토큰은 사용자의 의도하지 않은 상태 변경 요청을 차단합니다.',
    termReferences: [{ termId: 'term-csrf', startIndex: 0, endIndex: 4 }],
  },
]

export function getDemoInstructorCurriculums(userId: string) {
  return mockCurriculumEntities
    .filter((curriculum) => curriculum.instructor.instructorId === userId)
    .map((curriculum) => {
      const outline = buildMockCurriculumOutline(curriculum)
      const lessons = outline.flatMap((section) => section.lessons)
      const nextSession = lessons.find((lesson) => lesson.liveSession && ['SCHEDULED', 'OPEN'].includes(lesson.liveSession.status))
      return {
        curriculumId: curriculum.curriculumId,
        title: curriculum.title,
        summary: curriculum.summary,
        description: curriculum.description,
        lifecycleStatus: curriculum.lifecycleStatus,
        startsAt: curriculum.period?.startsAt ?? '',
        endsAt: curriculum.period?.endsAt ?? '',
        instructor: curriculum.instructor.displayName,
        enrolleeCount: curriculum.enrolleeCount,
        thumbnailUrl: curriculum.thumbnailUrl,
        publishedLessonCount: lessons.filter((lesson) => lesson.status === 'PUBLISHED').length,
        lessonCount: curriculum.lessonCount,
        nextSession: nextSession?.liveSession?.scheduledAt ?? '일정 미정',
      }
    })
}

export function getDemoStudentCurriculums(userId: string) {
  return getMockEnrollments(userId)
    .filter((enrollment) => enrollment.status === 'ACTIVE')
    .map((enrollment) => {
      const curriculum = getMockCurriculum(enrollment.curriculumId)!
      const progress = getMockProgress(curriculum, enrollment)
      const firstSection = buildMockCurriculumOutline(curriculum)[0]
      const firstLesson = firstSection?.lessons[0]
      const lastRecordedLesson = findLastRecordedLesson(curriculum, enrollment)
      const continueLearning = lastRecordedLesson
        ? { kind: 'VOD' as const, sectionId: lastRecordedLesson.sectionId, lessonId: lastRecordedLesson.lessonId }
        : firstSection && firstLesson
          ? { kind: 'START' as const, sectionId: firstSection.sectionId, lessonId: firstLesson.lessonId }
          : null
      return {
        curriculumId: curriculum.curriculumId,
        title: curriculum.title,
        summary: curriculum.summary,
        description: curriculum.description,
        lifecycleStatus: curriculum.lifecycleStatus,
        startsAt: curriculum.period?.startsAt ?? '',
        endsAt: curriculum.period?.endsAt ?? '',
        instructor: curriculum.instructor.displayName,
        enrolleeCount: curriculum.enrolleeCount,
        thumbnailUrl: curriculum.thumbnailUrl,
        progress: progress.progressPercent,
        completedLessonCount: progress.completedLessonCount,
        lessonCount: progress.totalLessonCount,
        continueLearning,
      }
    })
}

export function getDemoPendingStudentCurriculums(userId: string) {
  return getMockEnrollments(userId)
    .filter((enrollment) => enrollment.status === 'PENDING')
    .map((enrollment) => {
      const curriculum = getMockCurriculum(enrollment.curriculumId)!
      return {
        curriculumId: curriculum.curriculumId,
        title: curriculum.title,
        summary: curriculum.summary,
        thumbnailUrl: curriculum.thumbnailUrl,
        instructor: curriculum.instructor.displayName,
      }
    })
}

export function getDemoUpcomingLiveSession(userId: string) {
  const curriculums = getMockEnrollments(userId)
    .filter((enrollment) => enrollment.status === 'ACTIVE')
    .map((enrollment) => ({ curriculum: getMockCurriculum(enrollment.curriculumId)! }))
    .filter((entry) => entry.curriculum)
  return findNextLiveLesson(curriculums)
}

/**
 * 강사 대시보드의 다음 라이브. 학생용 `getDemoUpcomingLiveSession`과 같은 규칙이다 —
 * "오늘"로 거르지 않고 예정/진행 세션 중 `scheduledAt`이 가장 이른 하나를 돌려준다.
 * 서버(`CatalogService.nearestLiveSession`)와 같은 규칙을 쓰기 위한 것이다.
 */
export function getDemoUpcomingInstructorLiveSession(userId: string) {
  const curriculums = mockCurriculumEntities
    .filter((curriculum) => curriculum.instructor.instructorId === userId)
    .map((curriculum) => ({ curriculum }))
  return findNextLiveLesson(curriculums)
}

export function getDemoStudentLearningSummary(userId: string) {
  const curriculums = getDemoStudentCurriculums(userId)
  const completedCurriculumCount = curriculums.filter((curriculum) => curriculum.progress >= 100).length
  const inProgressCurriculumCount = curriculums.length - completedCurriculumCount
  const completedLessonCount = curriculums.reduce((sum, curriculum) => sum + curriculum.completedLessonCount, 0)
  const averageProgress = curriculums.length > 0
    ? Math.round(curriculums.reduce((sum, curriculum) => sum + curriculum.progress, 0) / curriculums.length)
    : 0

  return {
    inProgressCurriculumCount,
    completedCurriculumCount,
    averageProgress,
    completedLessonCount,
  }
}
