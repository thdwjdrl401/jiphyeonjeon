import type { CurriculumEnrollmentRecord, EnrollmentStatus } from './types'

export interface MockEnrollmentState extends CurriculumEnrollmentRecord {
  userId: string
  curriculumId: string
  decidedAt: string | null
  enrolledAt: string | null
  completedLessonCount: number
  lastLessonId: string | null
  sessionMs: number
}

const initialEnrollments: MockEnrollmentState[] = [
  {
    enrollmentId: 'enr-spring-active',
    userId: 'usr-student-01',
    curriculumId: 'cur-spring-live',
    status: 'ACTIVE',
    requestedAt: '2026-07-01T10:00:00+09:00',
    decidedAt: '2026-07-02T10:00:00+09:00',
    enrolledAt: '2026-07-02T10:00:00+09:00',
    completedLessonCount: 7,
    lastLessonId: 'cur-spring-live-lesson-7',
    sessionMs: 125_000,
  },
  {
    enrollmentId: 'enr-data-active',
    userId: 'usr-student-01',
    curriculumId: 'cur-data-story',
    status: 'ACTIVE',
    requestedAt: '2026-07-03T10:00:00+09:00',
    decidedAt: '2026-07-04T10:00:00+09:00',
    enrolledAt: '2026-07-04T10:00:00+09:00',
    completedLessonCount: 9,
    lastLessonId: 'cur-data-story-lesson-9',
    sessionMs: 225_000,
  },
  {
    enrollmentId: 'enr-react-active',
    userId: 'usr-student-01',
    curriculumId: 'cur-react-system',
    status: 'ACTIVE',
    requestedAt: '2026-07-05T10:00:00+09:00',
    decidedAt: '2026-07-06T10:00:00+09:00',
    enrolledAt: '2026-07-06T10:00:00+09:00',
    completedLessonCount: 0,
    lastLessonId: null,
    sessionMs: 0,
  },
  {
    enrollmentId: 'enr-sql-pending',
    userId: 'usr-student-01',
    curriculumId: 'cur-sql',
    status: 'PENDING',
    requestedAt: '2026-07-18T09:00:00+09:00',
    decidedAt: null,
    enrolledAt: null,
    completedLessonCount: 0,
    lastLessonId: null,
    sessionMs: 0,
  },
  {
    enrollmentId: 'enr-spring-pending-02',
    userId: 'usr-student-02',
    curriculumId: 'cur-spring-live',
    status: 'PENDING',
    requestedAt: '2026-07-21T09:30:00+09:00',
    decidedAt: null,
    enrolledAt: null,
    completedLessonCount: 0,
    lastLessonId: null,
    sessionMs: 0,
  },
  {
    enrollmentId: 'enr-spring-revoked-03',
    userId: 'usr-student-03',
    curriculumId: 'cur-spring-live',
    status: 'REVOKED',
    requestedAt: '2026-06-20T09:30:00+09:00',
    decidedAt: '2026-07-10T18:00:00+09:00',
    enrolledAt: '2026-06-21T11:00:00+09:00',
    completedLessonCount: 2,
    lastLessonId: 'cur-spring-live-lesson-2',
    sessionMs: 40_000,
  },
]

/**
 * 수강생 연락처. 강사 화면(수강생 명단)과 알림 문구("김학생 님이 …")가 같은 이름을 써야 하므로
 * 이름의 출처를 하나만 둔다 — 각자 자기 map을 들면 같은 학생이 화면마다 다른 이름으로 보인다.
 */
const mockStudentContacts: Record<string, { displayName: string; email: string }> = {
  'usr-student-01': { displayName: '김학생', email: 'student01@example.com' },
  'usr-student-02': { displayName: '수강생-21B3', email: 'student02@example.com' },
  'usr-student-03': { displayName: '박학습', email: 'student03@example.com' },
}

export function getMockStudentContact(userId: string) {
  return mockStudentContacts[userId] ?? null
}

function enrollmentKey(userId: string, curriculumId: string) {
  return `${userId}:${curriculumId}`
}

function createInitialEnrollments() {
  return new Map(
    initialEnrollments.map((state) => [enrollmentKey(state.userId, state.curriculumId), { ...state }]),
  )
}

let mockEnrollments = createInitialEnrollments()
let mockEnrollmentSequence = 0

export function resetMockEnrollmentStore() {
  mockEnrollments = createInitialEnrollments()
  mockEnrollmentSequence = 0
}

export function getMockEnrollment(userId: string, curriculumId: string) {
  return mockEnrollments.get(enrollmentKey(userId, curriculumId)) ?? null
}

export function getMockEnrollmentById(enrollmentId: string) {
  return [...mockEnrollments.values()].find((enrollment) => enrollment.enrollmentId === enrollmentId) ?? null
}

export function getMockEnrollments(userId: string) {
  return [...mockEnrollments.values()].filter((enrollment) => enrollment.userId === userId)
}

export function getMockEnrollmentsByCurriculum(curriculumId: string) {
  return [...mockEnrollments.values()].filter((enrollment) => enrollment.curriculumId === curriculumId)
}

export function putMockEnrollment(
  userId: string,
  curriculumId: string,
  status: Extract<EnrollmentStatus, 'PENDING' | 'ACTIVE'>,
  requestedAt: string,
) {
  const key = enrollmentKey(userId, curriculumId)
  const previous = mockEnrollments.get(key)
  mockEnrollmentSequence += 1
  const state: MockEnrollmentState = previous
    ? {
        ...previous,
        status,
        requestedAt,
        decidedAt: null,
        enrolledAt: status === 'ACTIVE' ? requestedAt : null,
      }
    : {
        enrollmentId: `enr-mock-${Date.now()}-${mockEnrollmentSequence}`,
        userId,
        curriculumId,
        status,
        requestedAt,
        decidedAt: null,
        enrolledAt: status === 'ACTIVE' ? requestedAt : null,
        completedLessonCount: 0,
        lastLessonId: null,
        sessionMs: 0,
      }
  mockEnrollments.set(key, state)
  return state
}

export function setMockEnrollmentStatus(
  enrollmentId: string,
  status: EnrollmentStatus,
  decidedAt: string | null,
  enrolledAt?: string | null,
) {
  const previous = getMockEnrollmentById(enrollmentId)
  if (!previous) return null
  const state: MockEnrollmentState = {
    ...previous,
    status,
    decidedAt,
    enrolledAt: enrolledAt === undefined ? previous.enrolledAt : enrolledAt,
  }
  mockEnrollments.set(enrollmentKey(previous.userId, previous.curriculumId), state)
  return state
}

export function updateMockEnrollmentStatus(
  userId: string,
  curriculumId: string,
  status: Extract<EnrollmentStatus, 'REJECTED' | 'REVOKED' | 'CANCELLED'>,
) {
  const previous = getMockEnrollment(userId, curriculumId)
  if (!previous) return null
  const decidedAt = status === 'REJECTED' ? new Date().toISOString() : previous.decidedAt
  return setMockEnrollmentStatus(previous.enrollmentId, status, decidedAt)
}
