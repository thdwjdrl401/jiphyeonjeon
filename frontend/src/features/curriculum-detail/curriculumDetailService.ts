import { apiClient } from '@/shared/api/client'
import { isMockApiEnabled } from '@/shared/config/runtime'
import type { AuthUser } from '@/features/auth/types'
import type {
  CurriculumDetailResponse,
  CurriculumOutlineSection,
} from '@/features/curriculum/types'
import { createFallbackViewerContext } from '@/features/curriculum/viewerContext'
import type { EnrollResult } from '@/features/enrollment/types'
import type { CurriculumOutlineLesson } from '@/features/lesson/types'
import { cancelMockEnrollment, enrollMockCurriculum, getMockCurriculumDetail } from './mockCurriculumDetails'

type CurriculumApiOutlineLesson = Pick<
  CurriculumOutlineLesson,
  'lessonId' | 'title' | 'order' | 'lessonStatus'
> & Partial<Omit<CurriculumOutlineLesson, 'lessonId' | 'title' | 'order' | 'lessonStatus'>>

type CurriculumApiOutlineSection = Omit<CurriculumOutlineSection, 'lessons'> & {
  lessons: CurriculumApiOutlineLesson[]
}

type CurriculumApiDetailResponse = Omit<
  CurriculumDetailResponse,
  'enrollmentPolicy' | 'outline' | 'viewerContext'
> & {
  enrollmentPolicy?: CurriculumDetailResponse['enrollmentPolicy']
  outline: CurriculumApiOutlineSection[]
  viewerContext?: CurriculumDetailResponse['viewerContext']
}

function normalizeLesson(lesson: CurriculumApiOutlineLesson): CurriculumOutlineLesson {
  return {
    ...lesson,
    scheduledAt: lesson.scheduledAt ?? null,
    durationMs: lesson.durationMs ?? null,
    access: lesson.access ?? {
      allowed: false,
      destination: null,
      reasonCode: 'ENROLLMENT_REQUIRED',
    },
    learning: lesson.learning ?? null,
  }
}

export async function getCurriculumDetail(curriculumId: string, viewer?: AuthUser) {
  if (isMockApiEnabled) return getMockCurriculumDetail(curriculumId)
  const { data } = await apiClient.get<CurriculumApiDetailResponse>(`/curriculums/${curriculumId}`)
  return {
    ...data,
    enrollmentPolicy: data.enrollmentPolicy ?? {
      type: 'INVITATION_ONLY',
      status: 'UNAVAILABLE',
      opensAt: null,
      closesAt: null,
    },
    outline: data.outline.map((section) => ({
      ...section,
      lessons: section.lessons.map(normalizeLesson),
    })),
    viewerContext: data.viewerContext ?? createFallbackViewerContext(viewer),
  }
}

export async function enrollInCurriculum(curriculumId: string) {
  if (isMockApiEnabled) return enrollMockCurriculum(curriculumId)
  const { data } = await apiClient.post<EnrollResult>(`/curriculums/${curriculumId}/enrollments`)
  return data
}

export async function cancelEnrollment(curriculumId: string) {
  if (isMockApiEnabled) return cancelMockEnrollment(curriculumId)
  await apiClient.delete(`/curriculums/${curriculumId}/enrollments/me`)
}
