import {
  buildMockCurriculumOutline,
  findMockLesson,
  findMockLiveSession,
  getMockCurriculum,
  getMockEnrollments,
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
    status: lesson.lessonStatus,
  })),
}))

export const demoLesson = {
  lessonId: primaryLessonContext.lesson.lessonId,
  title: primaryLessonContext.lesson.title,
  description: '인증 필터와 세션의 흐름을 실제 요청을 따라가며 이해합니다.',
  lessonStatus: primaryLessonContext.lesson.lessonStatus,
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

export function getDemoLesson(lessonId: string) {
  const context = findMockLesson(lessonId) ?? primaryLessonContext
  const isPrimaryLesson = context.lesson.lessonId === demoLesson.lessonId
  return {
    lessonId: context.lesson.lessonId,
    title: context.lesson.title,
    description: isPrimaryLesson
      ? demoLesson.description
      : `${context.lesson.title}의 핵심 개념과 실습 내용을 학습합니다.`,
    lessonStatus: context.lesson.lessonStatus,
    sectionId: context.section.sectionId,
    sectionTitle: context.section.title,
    curriculumId: context.curriculum.curriculumId,
    curriculumTitle: context.curriculum.title,
    materials: isPrimaryLesson
      ? demoLesson.materials
      : [{ id: `mat-${context.lesson.lessonId}`, name: `${context.lesson.lessonId}.pptx`, size: '2.4 MB', status: 'READY' }],
    liveSession: context.lesson.liveSession,
    replayStatus: context.lesson.replayStatus,
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

export const demoCaptions = [
  { at: '12:08', text: '인증이 끝난 뒤에는 SecurityContext가 현재 요청의 사용자 정보를 보관합니다.' },
  { at: '12:24', text: '이 경계를 서비스 계층의 권한 검사와 함께 보겠습니다.' },
  { at: '12:41', text: '세션 저장소를 Redis로 분리하면 여러 서버가 같은 인증 상태를 공유할 수 있습니다.' },
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
        publishedLessonCount: lessons.filter((lesson) => lesson.lessonStatus === 'PUBLISHED').length,
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
      const firstLessonId = buildMockCurriculumOutline(curriculum)[0]?.lessons[0]?.lessonId ?? ''
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
        lastLessonId: enrollment.lastLessonId ?? firstLessonId,
      }
    })
}
