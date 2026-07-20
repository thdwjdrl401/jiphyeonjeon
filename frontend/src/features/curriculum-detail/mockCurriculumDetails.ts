import { ApiError } from '@/shared/api/client'
import { peekMockUser } from '@/features/auth/mockAuth'
import type {
  CurriculumDetailPeriod,
  CurriculumDetailResponse,
  CurriculumEnrollmentPolicyType,
  CurriculumInstructorProfile,
  CurriculumOutlineSection,
} from '@/features/curriculum/types'
import type {
  CurriculumDetailViewerContext,
  CurriculumEnrollmentRecord,
  EnrollResult,
} from '@/features/enrollment/types'
import type { CurriculumOutlineLesson } from '@/features/lesson/types'

export const MOCK_ERROR_CURRICULUM_ID = 'cur_force_error'

interface MockCurriculumBase {
  curriculumId: string
  title: string
  summary: string
  description: string
  instructor: CurriculumInstructorProfile
  lifecycleStatus: string
  period: CurriculumDetailPeriod | null
  sectionCount: number
  lessonCount: number
  enrollmentPolicyType: CurriculumEnrollmentPolicyType
}

const curriculums: MockCurriculumBase[] = [
  {
    curriculumId: 'cur_spring_live',
    title: '라이브로 완성하는 Spring Boot',
    summary: '현업의 요청 흐름을 따라가며 견고한 백엔드를 함께 설계합니다.',
    description:
      '실제 서비스에서 마주치는 요청 흐름을 재현하며 Spring Boot로 안정적인 백엔드를 설계하는 방법을 다룹니다. 매 세션 라이브로 코드를 작성하고 질문에 답합니다.',
    instructor: {
      instructorId: 'usr_instructor_01',
      displayName: '이도현',
      bio: '10년간 대규모 트래픽 백엔드를 설계해온 백엔드 엔지니어입니다.',
      expertise: ['Spring', 'JPA', '분산 시스템'],
    },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-08-03T19:00:00+09:00', endsAt: '2026-09-24T21:00:00+09:00' },
    sectionCount: 6,
    lessonCount: 18,
    enrollmentPolicyType: 'IMMEDIATE',
  },
  {
    curriculumId: 'cur_data_story',
    title: '데이터로 설득하는 시각화',
    summary: '좋은 차트의 기준부터 비즈니스 스토리텔링까지 실습으로 익혀요.',
    description:
      '데이터를 그래프로 옮기는 방법이 아니라, 데이터로 사람을 설득하는 방법을 다룹니다. 실무 데이터셋으로 매주 시각화 결과물을 완성합니다.',
    instructor: {
      instructorId: 'usr_instructor_02',
      displayName: '박세린',
      bio: '데이터 시각화와 스토리텔링을 가르치는 프로덕트 애널리스트입니다.',
      expertise: ['데이터 시각화', 'SQL', '프레젠테이션'],
    },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-07-20T20:00:00+09:00', endsAt: '2026-08-28T22:00:00+09:00' },
    sectionCount: 5,
    lessonCount: 12,
    enrollmentPolicyType: 'IMMEDIATE',
  },
  {
    curriculumId: 'cur_react_system',
    title: 'React 디자인 시스템 실전',
    summary: '재사용 가능한 컴포넌트와 접근성 있는 인터랙션을 직접 구축합니다.',
    description:
      '버튼 하나부터 복합 컴포넌트까지, 실제 서비스에 적용 가능한 디자인 시스템을 처음부터 함께 만듭니다. 접근성 검증까지 포함합니다.',
    instructor: {
      instructorId: 'usr_instructor_03',
      displayName: '최유진',
      bio: '프론트엔드 디자인 시스템 팀을 이끌어온 시니어 엔지니어입니다.',
      expertise: ['React', '디자인 시스템', '웹 접근성'],
    },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-08-10T19:30:00+09:00', endsAt: '2026-10-05T21:30:00+09:00' },
    sectionCount: 7,
    lessonCount: 16,
    enrollmentPolicyType: 'IMMEDIATE',
  },
  {
    curriculumId: 'cur_ai_product',
    title: 'AI 제품 기획자를 위한 첫걸음',
    summary: '모델의 가능성과 한계를 이해하고 검증 가능한 AI 기능을 설계해요.',
    description:
      'AI 모델을 다루는 프로덕트를 기획할 때 필요한 감각을 기릅니다. 가설을 세우고 작은 실험으로 검증하는 흐름을 실습합니다.',
    instructor: {
      instructorId: 'usr_instructor_04',
      displayName: '윤하람',
      bio: 'AI 프로덕트 기획을 다수 리드해온 프로덕트 매니저입니다.',
      expertise: ['AI 프로덕트 기획', '실험 설계'],
    },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-09-01T20:00:00+09:00', endsAt: '2026-10-13T22:00:00+09:00' },
    sectionCount: 4,
    lessonCount: 10,
    enrollmentPolicyType: 'IMMEDIATE',
  },
  {
    curriculumId: 'cur_webrtc',
    title: 'WebRTC와 실시간 미디어',
    summary: '브라우저 미디어부터 SFU 아키텍처까지 실시간 서비스의 핵심을 다룹니다.',
    description:
      '브라우저의 미디어 API부터 SFU 기반 대규모 실시간 서비스 아키텍처까지, 실시간 미디어 서비스를 만드는 데 필요한 개념을 순서대로 다룹니다.',
    instructor: {
      instructorId: 'usr_instructor_05',
      displayName: '정민재',
      bio: '실시간 미디어 서버를 설계해온 미디어 엔지니어입니다.',
      expertise: ['WebRTC', 'SFU', '미디어 서버'],
    },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-07-13T19:00:00+09:00', endsAt: '2026-08-31T21:00:00+09:00' },
    sectionCount: 8,
    lessonCount: 20,
    enrollmentPolicyType: 'IMMEDIATE',
  },
  {
    curriculumId: 'cur_sql',
    title: '성능을 바꾸는 SQL 튜닝',
    summary: '실행 계획을 읽고 느린 쿼리의 원인을 단계적으로 찾아갑니다.',
    description:
      '실행 계획을 읽는 법부터 인덱스 설계까지, 느린 쿼리를 원인 단위로 분해해 개선하는 과정을 다룹니다. 정원이 있어 신청 후 승인을 거칩니다.',
    instructor: {
      instructorId: 'usr_instructor_06',
      displayName: '한지수',
      bio: '대용량 트래픽 서비스의 쿼리 성능을 개선해온 DBA입니다.',
      expertise: ['SQL 튜닝', '인덱스 설계'],
    },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-08-22T10:00:00+09:00', endsAt: '2026-09-26T12:00:00+09:00' },
    sectionCount: 5,
    lessonCount: 10,
    enrollmentPolicyType: 'APPROVAL_REQUIRED',
  },
  {
    curriculumId: 'cur_cloud',
    title: '처음 만나는 클라우드 아키텍처',
    summary: '확장성과 장애 대응을 중심으로 서비스 구조를 함께 그려봅니다.',
    description:
      '트래픽 증가와 장애 상황을 가정하고, 그에 대응하는 서비스 구조를 단계적으로 설계합니다.',
    instructor: {
      instructorId: 'usr_instructor_07',
      displayName: '고은채',
      bio: '클라우드 인프라 설계를 담당해온 인프라 엔지니어입니다.',
      expertise: ['클라우드 아키텍처', '장애 대응'],
    },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-09-07T19:00:00+09:00', endsAt: '2026-10-19T21:00:00+09:00' },
    sectionCount: 6,
    lessonCount: 14,
    enrollmentPolicyType: 'IMMEDIATE',
  },
  {
    curriculumId: 'cur_typescript',
    title: 'TypeScript 타입 설계 워크숍',
    summary: '복잡한 도메인을 안전하고 읽기 좋은 타입으로 표현하는 연습을 합니다.',
    description:
      '복잡한 도메인 로직을 타입으로 안전하게 표현하는 연습을 반복합니다. 실무 코드 리뷰에서 자주 나오는 패턴을 함께 다룹니다.',
    instructor: {
      instructorId: 'usr_instructor_08',
      displayName: '서다온',
      bio: '타입 설계 워크숍을 여러 차례 진행해온 프론트엔드 엔지니어입니다.',
      expertise: ['TypeScript', '타입 설계'],
    },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-07-27T19:30:00+09:00', endsAt: '2026-09-07T21:30:00+09:00' },
    sectionCount: 5,
    lessonCount: 12,
    enrollmentPolicyType: 'IMMEDIATE',
  },
  {
    curriculumId: 'cur_ux_research',
    title: '사용자를 이해하는 UX 리서치',
    summary: '인터뷰 설계부터 인사이트 도출까지 작은 팀을 위한 방법을 익혀요.',
    description:
      '적은 인원과 짧은 시간으로도 신뢰할 수 있는 인사이트를 얻는 리서치 방법을 다룹니다.',
    instructor: {
      instructorId: 'usr_instructor_09',
      displayName: '문소연',
      bio: '작은 팀을 위한 UX 리서치 방법론을 연구하는 UX 리서처입니다.',
      expertise: ['UX 리서치', '인터뷰 설계'],
    },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-08-15T10:00:00+09:00', endsAt: '2026-09-19T12:00:00+09:00' },
    sectionCount: 4,
    lessonCount: 9,
    enrollmentPolicyType: 'IMMEDIATE',
  },
  {
    curriculumId: 'cur_python',
    title: 'Python 자동화 레시피',
    summary: '반복 업무를 줄이는 작은 스크립트부터 데이터 파이프라인까지 만들어요.',
    description:
      '매일 반복하는 업무를 작은 스크립트로 줄이는 것부터 시작해, 정기적으로 도는 데이터 파이프라인까지 단계적으로 확장합니다.',
    instructor: {
      instructorId: 'usr_instructor_10',
      displayName: '오태경',
      bio: '업무 자동화와 데이터 파이프라인을 만들어온 데이터 엔지니어입니다.',
      expertise: ['Python', '자동화', '데이터 파이프라인'],
    },
    lifecycleStatus: 'PUBLISHED',
    period: { startsAt: '2026-09-05T13:00:00+09:00', endsAt: '2026-10-10T15:00:00+09:00' },
    sectionCount: 6,
    lessonCount: 15,
    enrollmentPolicyType: 'IMMEDIATE',
  },
]

function enrollmentKey(userId: string, curriculumId: string) {
  return `${userId}:${curriculumId}`
}

// 'usr_mock_student' is the fixed id mockAuth.ts assigns to every student login,
// so seeding by that id is how demo accounts start out already enrolled/pending.
const MOCK_STUDENT_ID = 'usr_mock_student'

// 이미 학습을 시작한 것으로 보여줄 수강생 curriculum. 목록에 없으면(=cur_react_system 등)
// 수강 중이어도 학습 기록이 0이라 '수강하기' 버튼이 뜬다.
const CURRICULUMS_WITH_PRIOR_LEARNING = new Set(['cur_spring_live', 'cur_ai_product', 'cur_cloud', 'cur_python'])

function createSeedEnrollments(): Map<string, CurriculumEnrollmentRecord> {
  const seed = new Map<string, CurriculumEnrollmentRecord>()
  for (const curriculumId of [...CURRICULUMS_WITH_PRIOR_LEARNING, 'cur_react_system']) {
    seed.set(enrollmentKey(MOCK_STUDENT_ID, curriculumId), {
      enrollmentId: `enr_seed_${curriculumId}`,
      status: 'ACTIVE',
      requestedAt: '2026-07-20T12:00:00+09:00',
    })
  }
  seed.set(enrollmentKey(MOCK_STUDENT_ID, 'cur_sql'), {
    enrollmentId: 'enr_seed_cur_sql',
    status: 'PENDING',
    requestedAt: '2026-07-18T09:00:00+09:00',
  })
  return seed
}

let mockEnrollments = createSeedEnrollments()

export function resetMockCurriculumDetails() {
  mockEnrollments = createSeedEnrollments()
}

async function wait() {
  if (import.meta.env.MODE === 'test') return
  await new Promise((resolve) => window.setTimeout(resolve, 380))
}

function buildOutline(curriculum: MockCurriculumBase): CurriculumOutlineSection[] {
  const lessonsPerSection = Math.ceil(curriculum.lessonCount / curriculum.sectionCount)
  let lessonOrder = 0
  return Array.from({ length: curriculum.sectionCount }, (_, sectionIndex) => {
    const sectionLessonCount = Math.min(
      lessonsPerSection,
      curriculum.lessonCount - sectionIndex * lessonsPerSection,
    )
    const lessons: CurriculumOutlineLesson[] = Array.from({ length: Math.max(sectionLessonCount, 0) }, () => {
      lessonOrder += 1
      return {
        lessonId: `${curriculum.curriculumId}_lesson_${lessonOrder}`,
        title: `${lessonOrder}강. 학습 주제 ${lessonOrder}`,
        order: lessonOrder,
        lessonStatus: 'PUBLISHED',
        scheduledAt: curriculum.period?.startsAt ?? null,
        durationMs: 3_600_000,
        access: { allowed: false, destination: null, reasonCode: 'ENROLLMENT_REQUIRED' },
        learning: null,
      }
    })
    return {
      sectionId: `${curriculum.curriculumId}_section_${sectionIndex + 1}`,
      title: `${sectionIndex + 1}. 섹션 ${sectionIndex + 1}`,
      description: null,
      order: sectionIndex + 1,
      lessons,
    }
  })
}

function applyViewerAccess(
  outline: CurriculumOutlineSection[],
  relationship: CurriculumDetailViewerContext['relationship'],
  completedLessonCount: number,
) {
  const canOpen = relationship === 'OWNER_INSTRUCTOR' || relationship === 'ENROLLED'
  let flatIndex = 0
  return outline.map((section) => ({
    ...section,
    lessons: section.lessons.map((lesson) => {
      flatIndex += 1
      if (!canOpen) {
        return {
          ...lesson,
          access: { allowed: false, destination: null, reasonCode: 'ENROLLMENT_REQUIRED' as const },
          learning: null,
        }
      }
      const learning =
        relationship === 'ENROLLED'
          ? {
              completed: flatIndex <= completedLessonCount,
              progressPercent: flatIndex <= completedLessonCount ? 100 : 0,
            }
          : null
      return {
        ...lesson,
        access: { allowed: true, destination: 'LESSON_DETAIL' as const, reasonCode: null },
        learning,
      }
    }),
  }))
}

function resolveViewerContext(curriculum: MockCurriculumBase, index: number): CurriculumDetailViewerContext {
  const user = peekMockUser()

  if (!user) {
    return {
      relationship: 'GUEST',
      allowedActions: ['LOGIN_TO_ENROLL'],
      enrollment: null,
      progress: null,
      nextLiveSession: null,
    }
  }

  if (user.role === 'INSTRUCTOR') {
    const isOwner = index === 0
    if (isOwner) {
      return {
        relationship: 'OWNER_INSTRUCTOR',
        allowedActions: ['MANAGE_CURRICULUM', 'EDIT_LESSON'],
        enrollment: null,
        progress: null,
        nextLiveSession: null,
      }
    }
    // 정책: 강사 계정은 자신이 담당하지 않는 커리큘럼도 수강할 수 없다(고정 규칙, 정책값과 무관).
    return {
      relationship: 'NON_OWNER_INSTRUCTOR',
      allowedActions: [],
      enrollment: null,
      progress: null,
      nextLiveSession: null,
    }
  }

  const overlay = mockEnrollments.get(enrollmentKey(user.userId, curriculum.curriculumId))

  if (overlay?.status === 'ACTIVE') {
    const hasPriorLearning = CURRICULUMS_WITH_PRIOR_LEARNING.has(curriculum.curriculumId)
    const completedLessonCount = hasPriorLearning ? Math.max(1, Math.floor(curriculum.lessonCount * 0.36)) : 0
    return {
      relationship: 'ENROLLED',
      allowedActions: ['VIEW_LESSON', 'CONTINUE_LEARNING'],
      enrollment: overlay,
      progress: {
        completedLessonCount,
        totalLessonCount: curriculum.lessonCount,
        progressPercent: Math.round((completedLessonCount / curriculum.lessonCount) * 100),
        lastLearning: hasPriorLearning
          ? { lessonId: `${curriculum.curriculumId}_lesson_${completedLessonCount}`, sessionMs: 125_000 }
          : null,
      },
      nextLiveSession: null,
    }
  }

  if (overlay?.status === 'PENDING') {
    return {
      relationship: 'PENDING_ENROLLMENT',
      allowedActions: ['CANCEL_ENROLLMENT'],
      enrollment: overlay,
      progress: null,
      nextLiveSession: null,
    }
  }

  return {
    relationship: 'UNENROLLED_STUDENT',
    allowedActions: curriculum.enrollmentPolicyType === 'INVITATION_ONLY' ? [] : ['ENROLL'],
    enrollment: null,
    progress: null,
    nextLiveSession: null,
  }
}

export async function getMockCurriculumDetail(curriculumId: string): Promise<CurriculumDetailResponse> {
  await wait()

  if (curriculumId === MOCK_ERROR_CURRICULUM_ID) {
    throw new ApiError('일시적인 오류가 발생했어요.', 500, 'CURRICULUM_DETAIL_UNAVAILABLE')
  }

  const index = curriculums.findIndex((curriculum) => curriculum.curriculumId === curriculumId)
  if (index === -1) {
    throw new ApiError('커리큘럼을 찾을 수 없어요.', 404, 'CURRICULUM_NOT_FOUND')
  }
  const curriculum = curriculums[index]

  const viewerContext = resolveViewerContext(curriculum, index)
  const outline = applyViewerAccess(
    buildOutline(curriculum),
    viewerContext.relationship,
    viewerContext.progress?.completedLessonCount ?? 0,
  )

  return {
    curriculumId: curriculum.curriculumId,
    title: curriculum.title,
    summary: curriculum.summary,
    description: curriculum.description,
    thumbnailUrl: null,
    lifecycleStatus: curriculum.lifecycleStatus,
    period: curriculum.period,
    enrollmentPolicy: {
      type: curriculum.enrollmentPolicyType,
      status: 'OPEN',
      opensAt: null,
      closesAt: null,
    },
    instructor: curriculum.instructor,
    outline,
    viewerContext,
  }
}

export async function enrollMockCurriculum(curriculumId: string): Promise<EnrollResult> {
  await wait()

  const user = peekMockUser()
  if (!user) {
    throw new ApiError('로그인이 필요해요.', 401, 'AUTH_SESSION_REQUIRED')
  }
  if (user.role === 'INSTRUCTOR') {
    throw new ApiError('강사 계정은 다른 커리큘럼을 수강할 수 없어요.', 403, 'ENROLLMENT_NOT_ALLOWED_FOR_ROLE')
  }

  const curriculum = curriculums.find((item) => item.curriculumId === curriculumId)
  if (!curriculum) {
    throw new ApiError('커리큘럼을 찾을 수 없어요.', 404, 'CURRICULUM_NOT_FOUND')
  }

  const key = enrollmentKey(user.userId, curriculum.curriculumId)
  if (mockEnrollments.has(key)) {
    throw new ApiError('이미 신청했거나 수강 중이에요.', 409, 'ENROLLMENT_ALREADY_EXISTS')
  }
  if (curriculum.enrollmentPolicyType === 'INVITATION_ONLY') {
    throw new ApiError('초대를 통해서만 신청할 수 있어요.', 409, 'ENROLLMENT_CLOSED')
  }

  // 정책: 새로 신청한 수강은 정책 유형과 무관하게 항상 승인 대기 상태로 시작한다.
  const now = new Date().toISOString()
  const status = 'PENDING'
  const record: CurriculumEnrollmentRecord = {
    enrollmentId: `enr_mock_${Date.now()}`,
    status,
    requestedAt: now,
  }
  mockEnrollments.set(key, record)

  return {
    enrollmentId: record.enrollmentId,
    curriculumId: curriculum.curriculumId,
    status,
    requestedAt: now,
    approvedAt: null,
  }
}

export async function cancelMockEnrollment(curriculumId: string): Promise<void> {
  await wait()

  const user = peekMockUser()
  if (!user) {
    throw new ApiError('로그인이 필요해요.', 401, 'AUTH_SESSION_REQUIRED')
  }

  const key = enrollmentKey(user.userId, curriculumId)
  const record = mockEnrollments.get(key)
  if (!record) {
    throw new ApiError('신청 내역을 찾을 수 없어요.', 404, 'ENROLLMENT_NOT_FOUND')
  }
  if (record.status !== 'PENDING') {
    throw new ApiError('이미 처리된 신청이라 취소할 수 없어요.', 409, 'ENROLLMENT_CANNOT_BE_CANCELLED')
  }
  mockEnrollments.delete(key)
}
