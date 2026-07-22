import { peekMockUser } from '@/features/auth/mockAuth'
import type { CurriculumDetailResponse, CurriculumOutlineSection } from '@/features/curriculum/types'
import {
  buildMockCurriculumOutline,
  deleteMockEnrollment,
  getMockCurriculum,
  getMockDetailViewerContext,
  getMockEnrollment,
  putMockPendingEnrollment,
  resetMockDatabase,
  resolveMockLessonDestination,
} from '@/features/demo/mockDatabase'
import type { EnrollResult } from '@/features/enrollment/types'
import { ApiError } from '@/shared/api/client'

export const MOCK_ERROR_CURRICULUM_ID = 'cur-force-error'

export function resetMockCurriculumDetails() {
  resetMockDatabase()
}

async function wait() {
  if (import.meta.env.MODE === 'test') return
  await new Promise((resolve) => window.setTimeout(resolve, 380))
}

function applyViewerAccess(
  outline: CurriculumOutlineSection[],
  relationship: CurriculumDetailResponse['viewerContext']['relationship'],
  completedLessonCount: number,
) {
  const canOpen = relationship === 'OWNER_INSTRUCTOR' || relationship === 'ENROLLED'
  let flatIndex = 0
  return outline.map((section) => ({
    ...section,
    lessons: section.lessons.map((lesson) => {
      flatIndex += 1
      const isStudentDraft = relationship === 'ENROLLED' && lesson.lessonStatus !== 'PUBLISHED'
      if (!canOpen || isStudentDraft) {
        return {
          ...lesson,
          access: {
            allowed: false,
            destination: null,
            reasonCode: isStudentDraft ? 'LESSON_NOT_PUBLISHED' as const : 'ENROLLMENT_REQUIRED' as const,
          },
          learning: null,
        }
      }
      const isPast = flatIndex <= completedLessonCount
      return {
        ...lesson,
        access: { allowed: true, destination: resolveMockLessonDestination(lesson), reasonCode: null },
        learning: relationship === 'ENROLLED'
          ? { completed: isPast, progressPercent: isPast ? 100 : 0 }
          : null,
      }
    }),
  }))
}

export async function getMockCurriculumDetail(curriculumId: string): Promise<CurriculumDetailResponse> {
  await wait()
  if (curriculumId === MOCK_ERROR_CURRICULUM_ID) {
    throw new ApiError('일시적인 오류가 발생했어요.', 500, 'CURRICULUM_DETAIL_UNAVAILABLE')
  }

  const curriculum = getMockCurriculum(curriculumId)
  if (!curriculum) {
    throw new ApiError('커리큘럼을 찾을 수 없어요.', 404, 'CURRICULUM_NOT_FOUND')
  }

  const viewerContext = getMockDetailViewerContext(peekMockUser(), curriculum)
  const outline = applyViewerAccess(
    buildMockCurriculumOutline(curriculum),
    viewerContext.relationship,
    viewerContext.progress?.completedLessonCount ?? 0,
  )

  return {
    curriculumId: curriculum.curriculumId,
    title: curriculum.title,
    summary: curriculum.summary,
    description: curriculum.description,
    thumbnailUrl: curriculum.thumbnailUrl,
    lifecycleStatus: curriculum.lifecycleStatus,
    period: curriculum.period,
    materials: curriculum.materials.map((material) => ({ ...material })),
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
  if (!user) throw new ApiError('로그인이 필요해요.', 401, 'AUTH_SESSION_REQUIRED')
  if (user.role === 'INSTRUCTOR') {
    throw new ApiError('강사 계정은 다른 커리큘럼을 수강할 수 없어요.', 403, 'ENROLLMENT_NOT_ALLOWED_FOR_ROLE')
  }

  const curriculum = getMockCurriculum(curriculumId)
  if (!curriculum) throw new ApiError('커리큘럼을 찾을 수 없어요.', 404, 'CURRICULUM_NOT_FOUND')
  if (getMockEnrollment(user.userId, curriculumId)) {
    throw new ApiError('이미 신청했거나 수강 중이에요.', 409, 'ENROLLMENT_ALREADY_EXISTS')
  }
  if (curriculum.enrollmentPolicyType === 'INVITATION_ONLY') {
    throw new ApiError('초대를 통해서만 신청할 수 있어요.', 409, 'ENROLLMENT_CLOSED')
  }

  const requestedAt = new Date().toISOString()
  const record = putMockPendingEnrollment(user.userId, curriculumId, requestedAt)
  return {
    enrollmentId: record.enrollmentId,
    curriculumId,
    userId: user.userId,
    status: record.status,
    requestedAt,
    decidedAt: null,
    enrolledAt: null,
  }
}

export async function cancelMockEnrollment(curriculumId: string): Promise<void> {
  await wait()
  const user = peekMockUser()
  if (!user) throw new ApiError('로그인이 필요해요.', 401, 'AUTH_SESSION_REQUIRED')

  const record = getMockEnrollment(user.userId, curriculumId)
  if (!record) throw new ApiError('신청 내역을 찾을 수 없어요.', 404, 'ENROLLMENT_NOT_FOUND')
  if (record.status !== 'PENDING' && record.status !== 'ACTIVE') {
    throw new ApiError('이미 처리된 신청이라 취소할 수 없어요.', 409, 'ENROLLMENT_CANNOT_BE_CANCELLED')
  }
  deleteMockEnrollment(user.userId, curriculumId)
}
