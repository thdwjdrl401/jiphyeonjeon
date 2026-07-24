import architectureCurriculumImage from '@/assets/images/curriculum-architecture.svg'
import dataCurriculumImage from '@/assets/images/curriculum-data.svg'
import springCurriculumImage from '@/assets/images/curriculum-spring.svg'
import { ApiError } from '@/shared/api/client'
import type { AuthUser } from '@/features/auth/types'
import type {
  CurriculumDetailPeriod,
  CurriculumEnrollmentPolicyType,
  CurriculumInstructorProfile,
  CurriculumMaterial,
  CurriculumOutlineSection,
  CurriculumProgress,
  CurriculumRelationship,
} from '@/features/curriculum/types'
import {
  getMockEnrollment,
  resetMockEnrollmentStore,
  type MockEnrollmentState,
} from '@/features/enrollment/mockEnrollmentStore'
import type { CurriculumDetailViewerContext } from '@/features/enrollment/types'
import type {
  CurriculumLiveSessionStatus,
  CurriculumOutlineLesson,
  CurriculumReplayStatus,
  LessonAccessDestination,
  LessonStatus,
} from '@/features/lesson/types'

export const MOCK_STUDENT_ID = 'usr-student-01'
export const MOCK_INSTRUCTOR_ID = 'usr-instructor-01'

// 게시/게시취소로 바뀐 레슨 상태를 세션 동안 기억한다. seed는 매 조회마다 다시
// 만들어지므로(buildMockCurriculumOutline) seed를 직접 고치지 않고 이 덮어쓰기 맵을 우선한다.
const lessonStatusOverrides = new Map<string, LessonStatus>()

export interface MockCurriculumEntity {
  curriculumId: string
  title: string
  summary: string
  description: string
  thumbnailUrl: string | null
  materials: CurriculumMaterial[]
  instructor: CurriculumInstructorProfile
  lifecycleStatus: string
  period: CurriculumDetailPeriod | null
  sectionCount: number
  lessonCount: number
  featured: boolean
  catalogVisible: boolean
  enrollmentPolicyType: CurriculumEnrollmentPolicyType
  enrolleeCount: number
}

interface MockLessonSeed {
  lessonId: string
  title: string
  status: LessonStatus
}

interface MockSectionSeed {
  title: string
  description: string | null
  lessons: MockLessonSeed[]
}

const instructorProfiles: CurriculumInstructorProfile[] = [
  { instructorId: MOCK_INSTRUCTOR_ID, displayName: '이도현', bio: '10년간 대규모 트래픽 백엔드를 설계해온 백엔드 엔지니어입니다.', expertise: ['Spring', 'JPA', '분산 시스템'] },
  { instructorId: 'usr-instructor-02', displayName: '박세린', bio: '데이터 시각화와 스토리텔링을 가르치는 프로덕트 애널리스트입니다.', expertise: ['데이터 시각화', 'SQL', '프레젠테이션'] },
  { instructorId: 'usr-instructor-03', displayName: '최유진', bio: '프론트엔드 디자인 시스템 팀을 이끌어온 시니어 엔지니어입니다.', expertise: ['React', '디자인 시스템', '웹 접근성'] },
  { instructorId: 'usr-instructor-04', displayName: '윤하람', bio: 'AI 프로덕트 기획을 다수 리드해온 프로덕트 매니저입니다.', expertise: ['AI 프로덕트 기획', '실험 설계'] },
  { instructorId: 'usr-instructor-05', displayName: '정민재', bio: '실시간 미디어 서버를 설계해온 미디어 엔지니어입니다.', expertise: ['WebRTC', 'SFU', '미디어 서버'] },
  { instructorId: 'usr-instructor-06', displayName: '한지수', bio: '대용량 트래픽 서비스의 쿼리 성능을 개선해온 DBA입니다.', expertise: ['SQL 튜닝', '인덱스 설계'] },
  { instructorId: 'usr-instructor-07', displayName: '고은채', bio: '클라우드 인프라 설계를 담당해온 인프라 엔지니어입니다.', expertise: ['클라우드 아키텍처', '장애 대응'] },
  { instructorId: 'usr-instructor-08', displayName: '서다온', bio: '타입 설계 워크숍을 여러 차례 진행해온 프론트엔드 엔지니어입니다.', expertise: ['TypeScript', '타입 설계'] },
  { instructorId: 'usr-instructor-09', displayName: '문소연', bio: '작은 팀을 위한 UX 리서치 방법론을 연구하는 UX 리서처입니다.', expertise: ['UX 리서치', '인터뷰 설계'] },
  { instructorId: 'usr-instructor-10', displayName: '오태경', bio: '업무 자동화와 데이터 파이프라인을 만들어온 데이터 엔지니어입니다.', expertise: ['Python', '자동화', '데이터 파이프라인'] },
]

export const mockCurriculumEntities: MockCurriculumEntity[] = [
  {
    curriculumId: 'cur-spring-live', title: '라이브로 완성하는 Spring Boot',
    summary: '현업의 요청 흐름을 따라가며 견고한 백엔드를 함께 설계합니다.',
    description: '실제 서비스에서 마주치는 요청 흐름을 재현하며 Spring Boot로 안정적인 백엔드를 설계하는 방법을 다룹니다. 매 라이브 강의에서 코드를 작성하고 질문에 답합니다.',
    thumbnailUrl: springCurriculumImage, instructor: instructorProfiles[0], lifecycleStatus: 'PUBLISHED',
    materials: [
      { materialId: 'mat-curr-spring-guide', fileName: 'Spring Boot 커리큘럼 가이드.pptx', fileSize: 2_516_582 },
      { materialId: 'mat-curr-spring-setup', fileName: '공통 실습 환경 설정.pptx', fileSize: 1_887_437 },
    ],
    period: { startsAt: '2026-08-03T19:00:00+09:00', endsAt: '2026-09-24T21:00:00+09:00' },
    sectionCount: 6, lessonCount: 18, featured: true, catalogVisible: true,
    enrollmentPolicyType: 'APPROVAL_REQUIRED', enrolleeCount: 48,
  },
  {
    curriculumId: 'cur-data-story', title: '데이터로 설득하는 시각화',
    summary: '좋은 차트의 기준부터 비즈니스 스토리텔링까지 실습으로 익혀요.',
    description: '데이터를 그래프로 옮기는 방법이 아니라, 데이터로 사람을 설득하는 방법을 다룹니다. 실무 데이터셋으로 매주 시각화 결과물을 완성합니다.',
    thumbnailUrl: dataCurriculumImage, instructor: instructorProfiles[1], lifecycleStatus: 'PUBLISHED',
    materials: [{ materialId: 'mat-curr-data-guide', fileName: '시각화 실습 데이터 안내.pptx', fileSize: 1_363_149 }],
    period: { startsAt: '2026-07-20T20:00:00+09:00', endsAt: '2026-08-28T22:00:00+09:00' },
    sectionCount: 5, lessonCount: 12, featured: true, catalogVisible: true,
    enrollmentPolicyType: 'APPROVAL_REQUIRED', enrolleeCount: 31,
  },
  {
    curriculumId: 'cur-react-system', title: 'React 디자인 시스템 실전',
    summary: '재사용 가능한 컴포넌트와 접근성 있는 인터랙션을 직접 구축합니다.',
    description: '버튼 하나부터 복합 컴포넌트까지, 실제 서비스에 적용 가능한 디자인 시스템을 처음부터 함께 만듭니다. 접근성 검증까지 포함합니다.',
    thumbnailUrl: architectureCurriculumImage, instructor: instructorProfiles[2], lifecycleStatus: 'PUBLISHED',
    materials: [],
    period: { startsAt: '2026-08-10T19:30:00+09:00', endsAt: '2026-10-05T21:30:00+09:00' },
    sectionCount: 7, lessonCount: 16, featured: true, catalogVisible: true,
    enrollmentPolicyType: 'APPROVAL_REQUIRED', enrolleeCount: 24,
  },
  {
    curriculumId: 'cur-ai-product', title: 'AI 제품 기획자를 위한 첫걸음',
    summary: '모델의 가능성과 한계를 이해하고 검증 가능한 AI 기능을 설계해요.',
    description: 'AI 모델을 다루는 프로덕트를 기획할 때 필요한 감각을 기릅니다. 가설을 세우고 작은 실험으로 검증하는 흐름을 실습합니다.',
    thumbnailUrl: null, instructor: instructorProfiles[3], lifecycleStatus: 'PUBLISHED',
    materials: [],
    period: { startsAt: '2026-09-01T20:00:00+09:00', endsAt: '2026-10-13T22:00:00+09:00' },
    sectionCount: 4, lessonCount: 10, featured: true, catalogVisible: true,
    enrollmentPolicyType: 'APPROVAL_REQUIRED', enrolleeCount: 18,
  },
  {
    curriculumId: 'cur-webrtc', title: 'WebRTC와 실시간 미디어',
    summary: '브라우저 미디어부터 SFU 아키텍처까지 실시간 서비스의 핵심을 다룹니다.',
    description: '브라우저의 미디어 API부터 SFU 기반 대규모 실시간 서비스 아키텍처까지, 실시간 미디어 서비스를 만드는 데 필요한 개념을 순서대로 다룹니다.',
    thumbnailUrl: null, instructor: instructorProfiles[4], lifecycleStatus: 'PUBLISHED',
    materials: [],
    period: { startsAt: '2026-07-13T19:00:00+09:00', endsAt: '2026-08-31T21:00:00+09:00' },
    sectionCount: 8, lessonCount: 20, featured: true, catalogVisible: true,
    enrollmentPolicyType: 'APPROVAL_REQUIRED', enrolleeCount: 56,
  },
  {
    curriculumId: 'cur-sql', title: '성능을 바꾸는 SQL 튜닝',
    summary: '실행 계획을 읽고 느린 쿼리의 원인을 단계적으로 찾아갑니다.',
    description: '실행 계획을 읽는 법부터 인덱스 설계까지, 느린 쿼리를 원인 단위로 분해해 개선하는 과정을 다룹니다. 정원이 있어 신청 후 승인을 거칩니다.',
    thumbnailUrl: null, instructor: instructorProfiles[5], lifecycleStatus: 'PUBLISHED',
    materials: [],
    period: { startsAt: '2026-08-22T10:00:00+09:00', endsAt: '2026-09-26T12:00:00+09:00' },
    sectionCount: 5, lessonCount: 10, featured: true, catalogVisible: true,
    enrollmentPolicyType: 'APPROVAL_REQUIRED', enrolleeCount: 20,
  },
  {
    curriculumId: 'cur-cloud', title: '처음 만나는 클라우드 아키텍처',
    summary: '확장성과 장애 대응을 중심으로 서비스 구조를 함께 그려봅니다.',
    description: '트래픽 증가와 장애 상황을 가정하고, 그에 대응하는 서비스 구조를 단계적으로 설계합니다.',
    thumbnailUrl: null, instructor: instructorProfiles[6], lifecycleStatus: 'PUBLISHED',
    materials: [],
    period: { startsAt: '2026-09-07T19:00:00+09:00', endsAt: '2026-10-19T21:00:00+09:00' },
    sectionCount: 6, lessonCount: 14, featured: false, catalogVisible: true,
    enrollmentPolicyType: 'APPROVAL_REQUIRED', enrolleeCount: 17,
  },
  {
    curriculumId: 'cur-typescript', title: 'TypeScript 타입 설계 워크숍',
    summary: '복잡한 도메인을 안전하고 읽기 좋은 타입으로 표현하는 연습을 합니다.',
    description: '복잡한 도메인 로직을 타입으로 안전하게 표현하는 연습을 반복합니다. 실무 코드 리뷰에서 자주 나오는 패턴을 함께 다룹니다.',
    thumbnailUrl: null, instructor: instructorProfiles[7], lifecycleStatus: 'PUBLISHED',
    materials: [],
    period: { startsAt: '2026-07-27T19:30:00+09:00', endsAt: '2026-09-07T21:30:00+09:00' },
    sectionCount: 5, lessonCount: 12, featured: false, catalogVisible: true,
    enrollmentPolicyType: 'IMMEDIATE', enrolleeCount: 28,
  },
  {
    curriculumId: 'cur-ux-research', title: '사용자를 이해하는 UX 리서치',
    summary: '인터뷰 설계부터 인사이트 도출까지 작은 팀을 위한 방법을 익혀요.',
    description: '적은 인원과 짧은 시간으로도 신뢰할 수 있는 인사이트를 얻는 리서치 방법을 다룹니다.',
    thumbnailUrl: null, instructor: instructorProfiles[8], lifecycleStatus: 'PUBLISHED',
    materials: [],
    period: { startsAt: '2026-08-15T10:00:00+09:00', endsAt: '2026-09-19T12:00:00+09:00' },
    sectionCount: 4, lessonCount: 9, featured: false, catalogVisible: true,
    enrollmentPolicyType: 'APPROVAL_REQUIRED', enrolleeCount: 12,
  },
  {
    curriculumId: 'cur-python', title: 'Python 자동화 레시피',
    summary: '반복 업무를 줄이는 작은 스크립트부터 데이터 파이프라인까지 만들어요.',
    description: '매일 반복하는 업무를 작은 스크립트로 줄이는 것부터 시작해, 정기적으로 도는 데이터 파이프라인까지 단계적으로 확장합니다.',
    thumbnailUrl: null, instructor: instructorProfiles[9], lifecycleStatus: 'PUBLISHED',
    materials: [],
    period: { startsAt: '2026-09-05T13:00:00+09:00', endsAt: '2026-10-10T15:00:00+09:00' },
    sectionCount: 6, lessonCount: 15, featured: false, catalogVisible: true,
    enrollmentPolicyType: 'APPROVAL_REQUIRED', enrolleeCount: 22,
  },
  {
    curriculumId: 'cur-architecture', title: '확장 가능한 서비스 아키텍처',
    summary: '작은 서비스가 성장할 때 필요한 경계와 운영 전략을 설계합니다.',
    description: '트래픽과 조직이 함께 성장할 때 서비스 경계를 나누고 운영 위험을 줄이는 방법을 실습합니다.',
    thumbnailUrl: architectureCurriculumImage, instructor: instructorProfiles[0], lifecycleStatus: 'DRAFT',
    materials: [],
    period: null, sectionCount: 3, lessonCount: 7, featured: false, catalogVisible: false,
    enrollmentPolicyType: 'APPROVAL_REQUIRED', enrolleeCount: 0,
  },
]

const initialCurriculumCount = mockCurriculumEntities.length
const initialCurriculumMaterials = new Map(
  mockCurriculumEntities.map((curriculum) => [curriculum.curriculumId, curriculum.materials.map((material) => ({ ...material }))]),
)

const springSectionSeeds: MockSectionSeed[] = [
  {
    title: '서비스의 뼈대 세우기', description: '요청 흐름과 계층의 책임을 정리합니다.',
    lessons: [
      { lessonId: 'les-orientation', title: '오리엔테이션과 개발 환경', status: 'PUBLISHED' },
      { lessonId: 'les-request-flow', title: 'HTTP 요청 흐름 해부하기', status: 'PUBLISHED' },
      { lessonId: 'les-service-layer', title: '서비스 계층과 트랜잭션', status: 'PUBLISHED' },
    ],
  },
  {
    title: '인증과 인가', description: '세션 기반 인증과 안전한 권한 경계를 구현합니다.',
    lessons: [
      { lessonId: 'les-security', title: 'Spring Security 시작하기', status: 'PUBLISHED' },
      { lessonId: 'les-session', title: 'Redis 세션과 CSRF', status: 'PUBLISHED' },
    ],
  },
]

export function resetMockDatabase() {
  resetMockEnrollmentStore()
  lessonStatusOverrides.clear()
  mockCurriculumEntities.splice(initialCurriculumCount)
  for (const curriculum of mockCurriculumEntities) {
    curriculum.materials = initialCurriculumMaterials.get(curriculum.curriculumId)?.map((material) => ({ ...material })) ?? []
  }
}

export function putMockCurriculum(
  owner: AuthUser,
  input: Pick<MockCurriculumEntity, 'title' | 'summary' | 'description' | 'thumbnailUrl'> & {
    materials?: CurriculumMaterial[]
  },
) {
  const curriculum: MockCurriculumEntity = {
    curriculumId: `cur-draft-${Date.now()}`,
    title: input.title,
    summary: input.summary,
    description: input.description,
    thumbnailUrl: input.thumbnailUrl,
    materials: input.materials?.map((material) => ({ ...material })) ?? [],
    instructor: {
      instructorId: owner.userId,
      displayName: owner.displayName,
      bio: '공개 강사 소개를 입력해 주세요.',
      expertise: [],
    },
    lifecycleStatus: 'DRAFT',
    period: null,
    sectionCount: 0,
    lessonCount: 0,
    featured: false,
    catalogVisible: false,
    enrollmentPolicyType: 'APPROVAL_REQUIRED',
    enrolleeCount: 0,
  }
  mockCurriculumEntities.push(curriculum)
  return curriculum
}

export function getMockCurriculum(curriculumId: string) {
  return mockCurriculumEntities.find((curriculum) => curriculum.curriculumId === curriculumId) ?? null
}

export function updateMockCurriculumMaterials(curriculumId: string, materials: CurriculumMaterial[]) {
  const curriculum = getMockCurriculum(curriculumId)
  if (!curriculum) return null
  curriculum.materials = materials.map((material) => ({ ...material }))
  return curriculum
}

export function resolveMockRelationship(user: AuthUser | null, curriculum: MockCurriculumEntity): CurriculumRelationship {
  if (!user) return 'GUEST'
  if (user.role === 'INSTRUCTOR') {
    return curriculum.instructor.instructorId === user.userId ? 'OWNER_INSTRUCTOR' : 'NON_OWNER_INSTRUCTOR'
  }
  const enrollment = getMockEnrollment(user.userId, curriculum.curriculumId)
  if (enrollment?.status === 'ACTIVE') return 'ENROLLED'
  if (enrollment?.status === 'PENDING') return 'PENDING_ENROLLMENT'
  return 'UNENROLLED_STUDENT'
}

export function getMockProgress(curriculum: MockCurriculumEntity, enrollment: MockEnrollmentState): CurriculumProgress {
  return {
    completedLessonCount: enrollment.completedLessonCount,
    totalLessonCount: curriculum.lessonCount,
    progressPercent: Math.round((enrollment.completedLessonCount / curriculum.lessonCount) * 100),
  }
}

export function getMockDetailViewerContext(user: AuthUser | null, curriculum: MockCurriculumEntity): CurriculumDetailViewerContext {
  const relationship = resolveMockRelationship(user, curriculum)
  const enrollment = user ? getMockEnrollment(user.userId, curriculum.curriculumId) : null
  if (relationship === 'GUEST') {
    return { relationship, allowedActions: ['LOGIN_TO_ENROLL'], enrollment: null, progress: null, nextLiveSession: null }
  }
  if (relationship === 'OWNER_INSTRUCTOR') {
    return { relationship, allowedActions: ['MANAGE_CURRICULUM', 'EDIT_LESSON'], enrollment: null, progress: null, nextLiveSession: null }
  }
  if (relationship === 'NON_OWNER_INSTRUCTOR') {
    return { relationship, allowedActions: [], enrollment: null, progress: null, nextLiveSession: null }
  }
  if (relationship === 'PENDING_ENROLLMENT' && enrollment) {
    return { relationship, allowedActions: ['CANCEL_ENROLLMENT'], enrollment, progress: null, nextLiveSession: null }
  }
  if (relationship === 'ENROLLED' && enrollment) {
    const progress = getMockProgress(curriculum, enrollment)
    return {
      relationship,
      allowedActions: ['VIEW_LESSON', 'CONTINUE_LEARNING', 'CANCEL_ENROLLMENT'],
      enrollment,
      progress: {
        ...progress,
        lastLearning: enrollment.lastLessonId
          ? { lessonId: enrollment.lastLessonId, sessionMs: enrollment.sessionMs }
          : null,
      },
      nextLiveSession: null,
    }
  }
  return { relationship: 'UNENROLLED_STUDENT', allowedActions: ['ENROLL'], enrollment: null, progress: null, nextLiveSession: null }
}

function buildLessonAvailability(
  curriculum: MockCurriculumEntity,
  lessonOrder: number,
  lessonId: string,
): Pick<CurriculumOutlineLesson, 'liveSession' | 'replayStatus'> {
  const statusIndex = (lessonOrder - 1) % 6
  const statuses: CurriculumLiveSessionStatus[] = ['ENDED', 'ENDED', 'SCHEDULED', 'OPEN', 'LIVE', 'DRAFT']
  const replayStatuses: CurriculumReplayStatus[] = ['PUBLISHED', 'READY_FOR_REVIEW', 'NOT_READY', 'NOT_READY', 'NOT_READY', 'NOT_READY']
  if (statusIndex === 5) return { liveSession: null, replayStatus: replayStatuses[statusIndex] }
  const sessionId = lessonId === 'les-security' ? 'ses-security-live' : `ses-${curriculum.curriculumId}-${lessonOrder}`
  return {
    liveSession: { sessionId, status: statuses[statusIndex], scheduledAt: curriculum.period?.startsAt ?? null },
    replayStatus: replayStatuses[statusIndex],
  }
}

export function buildMockCurriculumOutline(curriculum: MockCurriculumEntity): CurriculumOutlineSection[] {
  const lessonsPerSection = Math.ceil(curriculum.lessonCount / curriculum.sectionCount)
  let lessonOrder = 0
  return Array.from({ length: curriculum.sectionCount }, (_, sectionIndex) => {
    const seed = curriculum.curriculumId === 'cur-spring-live' ? springSectionSeeds[sectionIndex] : undefined
    const sectionLessonCount = Math.min(lessonsPerSection, curriculum.lessonCount - sectionIndex * lessonsPerSection)
    const lessons = Array.from({ length: Math.max(sectionLessonCount, 0) }, (_, lessonIndex): CurriculumOutlineLesson => {
      lessonOrder += 1
      const lessonSeed = seed?.lessons[lessonIndex]
      const lessonId = lessonSeed?.lessonId ?? `${curriculum.curriculumId}-lesson-${lessonOrder}`
      const availability = buildLessonAvailability(curriculum, lessonOrder, lessonId)
      return {
        lessonId,
        title: lessonSeed?.title ?? `${lessonOrder}강. 학습 주제 ${lessonOrder}`,
        order: lessonOrder,
        status: lessonStatusOverrides.get(lessonId)
          ?? lessonSeed?.status
          ?? (curriculum.lifecycleStatus === 'DRAFT' ? 'DRAFT' : 'PUBLISHED'),
        scheduledAt: availability.liveSession?.scheduledAt ?? null,
        durationMs: 3_600_000,
        ...availability,
        access: { allowed: false, destination: null, reasonCode: 'ENROLLMENT_REQUIRED' },
        learning: null,
      }
    })
    return {
      sectionId: seed ? `sec-${sectionIndex === 0 ? 'foundation' : 'security'}` : `${curriculum.curriculumId}-section-${sectionIndex + 1}`,
      title: seed?.title ?? `${sectionIndex + 1}. 섹션 ${sectionIndex + 1}`,
      description: seed?.description ?? null,
      order: sectionIndex + 1,
      lessons,
    }
  })
}

export function resolveMockLessonDestination(lesson: CurriculumOutlineLesson): LessonAccessDestination {
  if (lesson.liveSession?.status === 'LIVE') return 'LIVE_CLASSROOM'
  if (lesson.liveSession && ['DRAFT', 'SCHEDULED', 'OPEN', 'STARTING'].includes(lesson.liveSession.status)) {
    return 'LIVE_SESSION'
  }
  if (lesson.replayStatus === 'PUBLISHED') return 'VOD'
  return 'LESSON_DETAIL'
}

export function findLastRecordedLesson(curriculum: MockCurriculumEntity, enrollment: MockEnrollmentState) {
  const flatLessons = buildMockCurriculumOutline(curriculum).flatMap((section) =>
    section.lessons.map((lesson) => ({ ...lesson, sectionId: section.sectionId })),
  )
  const reachedOrder = enrollment.lastLessonId
    ? flatLessons.find((lesson) => lesson.lessonId === enrollment.lastLessonId)?.order ?? 0
    : 0
  for (let index = flatLessons.length - 1; index >= 0; index -= 1) {
    const lesson = flatLessons[index]
    if (lesson.order > reachedOrder) continue
    if (resolveMockLessonDestination(lesson) === 'VOD') {
      return { sectionId: lesson.sectionId, lessonId: lesson.lessonId, title: lesson.title }
    }
  }
  return null
}

export function findNextLiveLesson(curriculums: Array<{ curriculum: MockCurriculumEntity }>, scheduledDate?: Date) {
  const openLiveStatuses: CurriculumLiveSessionStatus[] = ['SCHEDULED', 'OPEN', 'LIVE']
  const candidates = curriculums.flatMap(({ curriculum }) =>
    buildMockCurriculumOutline(curriculum).flatMap((section) =>
      section.lessons
        .filter((lesson) => lesson.liveSession && openLiveStatuses.includes(lesson.liveSession.status))
        .filter((lesson) => {
          if (!scheduledDate || !lesson.liveSession?.scheduledAt) return !scheduledDate
          const scheduledAt = new Date(lesson.liveSession.scheduledAt)
          return scheduledAt.getFullYear() === scheduledDate.getFullYear()
            && scheduledAt.getMonth() === scheduledDate.getMonth()
            && scheduledAt.getDate() === scheduledDate.getDate()
        })
        .map((lesson) => ({ curriculum, sectionId: section.sectionId, lesson, liveSession: lesson.liveSession! })),
    ),
  )
  if (candidates.length === 0) return null
  candidates.sort((a, b) => {
    const aTime = a.liveSession.scheduledAt ? new Date(a.liveSession.scheduledAt).getTime() : Number.POSITIVE_INFINITY
    const bTime = b.liveSession.scheduledAt ? new Date(b.liveSession.scheduledAt).getTime() : Number.POSITIVE_INFINITY
    return aTime - bTime
  })
  const next = candidates[0]
  return {
    curriculumId: next.curriculum.curriculumId,
    curriculumTitle: next.curriculum.title,
    sectionId: next.sectionId,
    lessonId: next.lesson.lessonId,
    lessonTitle: next.lesson.title,
    liveSessionStatus: next.liveSession.status,
    scheduledAt: next.liveSession.scheduledAt,
    durationMs: next.lesson.durationMs,
    sessionId: next.liveSession.sessionId,
  }
}

export function findMockLesson(lessonId: string) {
  for (const curriculum of mockCurriculumEntities) {
    for (const section of buildMockCurriculumOutline(curriculum)) {
      const lesson = section.lessons.find((item) => item.lessonId === lessonId)
      if (lesson) return { curriculum, section, lesson }
    }
  }
  return null
}

// 강사의 레슨 게시/게시취소를 mock 상태에 반영한다. 존재하지 않는 레슨은 실제 서버와
// 같은 404 계약으로 거절한다.
export function setMockLessonStatus(lessonId: string, status: LessonStatus) {
  if (!findMockLesson(lessonId)) {
    throw new ApiError('강의를 찾을 수 없습니다.', 404, 'LESSON_NOT_FOUND')
  }
  lessonStatusOverrides.set(lessonId, status)
  return { lessonId, status }
}

export function findMockLiveSession(sessionId: string) {
  for (const curriculum of mockCurriculumEntities) {
    for (const section of buildMockCurriculumOutline(curriculum)) {
      const lesson = section.lessons.find((item) => item.liveSession?.sessionId === sessionId)
      if (lesson?.liveSession) return { curriculum, section, lesson, liveSession: lesson.liveSession }
    }
  }
  return null
}
