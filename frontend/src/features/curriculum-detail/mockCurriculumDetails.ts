import { peekMockUser } from '@/features/auth/mockAuthService'
import type { AuthUser } from '@/features/auth/types'
import type { CurriculumDetailResponse, CurriculumOutlineSection } from '@/features/curriculum/types'
import {
  buildMockCurriculumOutline,
  getMockCurriculum,
  getMockDetailViewerContext,
  resetMockDatabase,
  resolveMockLessonDestination,
} from '@/features/demo/mockDatabase'
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
      const isStudentDraft = relationship === 'ENROLLED' && lesson.status !== 'PUBLISHED'
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

export async function getMockCurriculumDetail(
  curriculumId: string,
  viewer?: AuthUser,
): Promise<CurriculumDetailResponse> {
  await wait()
  if (curriculumId === MOCK_ERROR_CURRICULUM_ID) {
    throw new ApiError('일시적인 오류가 발생했어요.', 500, 'CURRICULUM_DETAIL_UNAVAILABLE')
  }

  const curriculum = getMockCurriculum(curriculumId)
  if (!curriculum) {
    throw new ApiError('커리큘럼을 찾을 수 없어요.', 404, 'CURRICULUM_NOT_FOUND')
  }

  const viewerContext = getMockDetailViewerContext(viewer ?? peekMockUser(), curriculum)
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
