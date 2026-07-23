import { peekMockUser } from '@/features/auth/mockAuthService'
import type { CurriculumLifecycleStatus } from '@/features/curriculum/types'
import { getMockCurriculum, getMockProgress } from '@/features/demo/mockDatabase'
import { ApiError } from '@/shared/api/client'
import type { EnrollmentService } from './enrollmentService.interface'
import {
  getMockEnrollment,
  getMockEnrollmentById,
  getMockEnrollments,
  getMockEnrollmentsByCurriculum,
  putMockEnrollment,
  setMockEnrollmentStatus,
  type MockEnrollmentState,
} from './mockEnrollmentStore'
import type {
  EnrollResult,
  EnrollmentRosterItem,
  EnrollmentStatus,
  EnrollmentStatusSummary,
} from './types'

const mockStudentContacts: Record<string, { displayName: string; email: string }> = {
  'usr-student-01': { displayName: '김학생', email: 'student01@example.com' },
  'usr-student-02': { displayName: '수강생-21B3', email: 'student02@example.com' },
  'usr-student-03': { displayName: '박학습', email: 'student03@example.com' },
}

async function wait() {
  if (import.meta.env.MODE === 'test') return
  await new Promise((resolve) => window.setTimeout(resolve, 380))
}

function toEnrollResult(enrollment: MockEnrollmentState): EnrollResult {
  return {
    enrollmentId: enrollment.enrollmentId,
    curriculumId: enrollment.curriculumId,
    userId: enrollment.userId,
    status: enrollment.status,
    requestedAt: enrollment.requestedAt,
    decidedAt: enrollment.decidedAt,
    enrolledAt: enrollment.enrolledAt,
  }
}

function requireStudent() {
  const user = peekMockUser()
  if (!user) throw new ApiError('로그인이 필요해요.', 401, 'AUTH_SESSION_REQUIRED')
  if (user.role !== 'STUDENT') {
    throw new ApiError('학생 계정만 수강 신청할 수 있어요.', 403, 'ENROLLMENT_NOT_ALLOWED_FOR_ROLE')
  }
  return user
}

function requireOwnedCurriculum(curriculumId: string) {
  const user = peekMockUser()
  if (!user) throw new ApiError('로그인이 필요해요.', 401, 'AUTH_SESSION_REQUIRED')
  if (user.role !== 'INSTRUCTOR') {
    throw new ApiError('강사만 수강생을 관리할 수 있어요.', 403, 'INSTRUCTOR_ROLE_REQUIRED')
  }
  const curriculum = getMockCurriculum(curriculumId)
  if (!curriculum) throw new ApiError('커리큘럼을 찾을 수 없어요.', 404, 'CURRICULUM_NOT_FOUND')
  if (curriculum.instructor.instructorId !== user.userId) {
    throw new ApiError('이 커리큘럼을 관리할 권한이 없어요.', 403, 'CURRICULUM_FORBIDDEN')
  }
  return curriculum
}

function requireEnrollment(curriculumId: string, enrollmentId: string) {
  requireOwnedCurriculum(curriculumId)
  const enrollment = getMockEnrollmentById(enrollmentId)
  if (!enrollment || enrollment.curriculumId !== curriculumId) {
    throw new ApiError('수강 기록을 찾을 수 없어요.', 404, 'ENROLLMENT_NOT_FOUND')
  }
  return enrollment
}

function allowedTransitions(status: EnrollmentStatus): EnrollmentStatus[] {
  if (status === 'PENDING') return ['ACTIVE', 'REJECTED']
  if (status === 'ACTIVE') return ['REVOKED']
  return []
}

function toRosterItem(enrollment: MockEnrollmentState): EnrollmentRosterItem {
  const contact = mockStudentContacts[enrollment.userId]
  return {
    enrollmentId: enrollment.enrollmentId,
    student: {
      userId: enrollment.userId,
      displayName: contact?.displayName ?? null,
      email: contact?.email ?? null,
    },
    status: enrollment.status,
    requestedAt: enrollment.requestedAt,
    decidedAt: enrollment.decidedAt,
    enrolledAt: enrollment.enrolledAt,
    allowedTransitions: allowedTransitions(enrollment.status),
  }
}

function summarize(enrollments: MockEnrollmentState[]): EnrollmentStatusSummary {
  return enrollments.reduce<EnrollmentStatusSummary>((summary, enrollment) => {
    const key = enrollment.status.toLocaleLowerCase() as keyof EnrollmentStatusSummary
    summary[key] += 1
    return summary
  }, { pending: 0, active: 0, rejected: 0, revoked: 0, cancelled: 0 })
}

export const mockEnrollmentService = {
  async apply(curriculumId) {
    await wait()
    const user = requireStudent()
    const curriculum = getMockCurriculum(curriculumId)
    if (!curriculum) throw new ApiError('커리큘럼을 찾을 수 없어요.', 404, 'CURRICULUM_NOT_FOUND')
    if (curriculum.lifecycleStatus !== 'PUBLISHED') {
      throw new ApiError('게시된 커리큘럼만 신청할 수 있어요.', 409, 'CURRICULUM_STATE_CONFLICT')
    }
    if (curriculum.enrollmentPolicyType === 'INVITATION_ONLY') {
      throw new ApiError('초대를 통해서만 신청할 수 있어요.', 409, 'ENROLLMENT_CLOSED')
    }
    const previous = getMockEnrollment(user.userId, curriculumId)
    if (previous?.status === 'PENDING' || previous?.status === 'ACTIVE') {
      throw new ApiError('이미 신청했거나 수강 중이에요.', 409, 'ENROLLMENT_ALREADY_EXISTS')
    }
    const requestedAt = new Date().toISOString()
    const status = curriculum.enrollmentPolicyType === 'IMMEDIATE' ? 'ACTIVE' : 'PENDING'
    return toEnrollResult(putMockEnrollment(user.userId, curriculumId, status, requestedAt))
  },
  async cancel(curriculumId) {
    await wait()
    const user = requireStudent()
    const enrollment = getMockEnrollment(user.userId, curriculumId)
    if (!enrollment) throw new ApiError('신청 내역을 찾을 수 없어요.', 404, 'ENROLLMENT_NOT_FOUND')
    if (enrollment.status !== 'PENDING' && enrollment.status !== 'ACTIVE') {
      throw new ApiError('이미 처리된 신청이라 취소할 수 없어요.', 409, 'ENROLLMENT_CANNOT_BE_CANCELLED')
    }
    const cancelled = setMockEnrollmentStatus(
      enrollment.enrollmentId,
      'CANCELLED',
      enrollment.decidedAt,
    )
    return toEnrollResult(cancelled!)
  },
  async getMyEnrollments() {
    await wait()
    const user = requireStudent()
    return getMockEnrollments(user.userId).flatMap((enrollment) => {
      const curriculum = getMockCurriculum(enrollment.curriculumId)
      if (!curriculum) return []
      const progress = getMockProgress(curriculum, enrollment)
      return [{
        enrollmentId: enrollment.enrollmentId,
        enrollmentStatus: enrollment.status,
        curriculumId: curriculum.curriculumId,
        title: curriculum.title,
        summary: curriculum.summary,
        thumbnailUrl: curriculum.thumbnailUrl,
        lifecycleStatus: curriculum.lifecycleStatus as CurriculumLifecycleStatus,
        instructor: curriculum.instructor.displayName,
        progress: progress.progressPercent,
        completedLessonCount: progress.completedLessonCount,
        lessonCount: progress.totalLessonCount,
      }]
    })
  },
  async getInstructorRoster(curriculumId, query = {}) {
    await wait()
    requireOwnedCurriculum(curriculumId)
    const all = getMockEnrollmentsByCurriculum(curriculumId)
      .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt) || a.enrollmentId.localeCompare(b.enrollmentId))
    const filtered = query.status ? all.filter((enrollment) => enrollment.status === query.status) : all
    const page = Math.max(0, query.page ?? 0)
    const size = Math.min(100, Math.max(1, query.size ?? 20))
    const start = page * size
    return {
      summary: summarize(all),
      items: filtered.slice(start, start + size).map(toRosterItem),
      page,
      size,
      totalElements: filtered.length,
      totalPages: Math.ceil(filtered.length / size),
      hasNext: start + size < filtered.length,
    }
  },
  async approve(curriculumId, enrollmentId) {
    await wait()
    const enrollment = requireEnrollment(curriculumId, enrollmentId)
    if (enrollment.status !== 'PENDING') {
      throw new ApiError('승인 대기 상태가 아니에요.', 409, 'ENROLLMENT_STATE_CONFLICT')
    }
    const now = new Date().toISOString()
    return toEnrollResult(setMockEnrollmentStatus(enrollmentId, 'ACTIVE', now, now)!)
  },
  async reject(curriculumId, enrollmentId) {
    await wait()
    const enrollment = requireEnrollment(curriculumId, enrollmentId)
    if (enrollment.status !== 'PENDING') {
      throw new ApiError('승인 대기 상태가 아니에요.', 409, 'ENROLLMENT_STATE_CONFLICT')
    }
    return toEnrollResult(setMockEnrollmentStatus(enrollmentId, 'REJECTED', new Date().toISOString())!)
  },
  async revoke(curriculumId, enrollmentId) {
    await wait()
    const enrollment = requireEnrollment(curriculumId, enrollmentId)
    if (enrollment.status !== 'ACTIVE') {
      throw new ApiError('수강 중이 아니라 제적할 수 없어요.', 409, 'ENROLLMENT_STATE_CONFLICT')
    }
    return toEnrollResult(setMockEnrollmentStatus(enrollmentId, 'REVOKED', enrollment.decidedAt)!)
  },
} satisfies EnrollmentService
