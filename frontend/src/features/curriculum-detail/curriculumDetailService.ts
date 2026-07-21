import { apiClient } from '@/shared/api/client'
import { requestByDataSource } from '@/shared/api/dataSource'
import type { AuthUser } from '@/features/auth/types'
import type {
  CurriculumDetailResponse,
  CurriculumOutlineSection,
} from '@/features/curriculum/types'
import { createFallbackViewerContext } from '@/features/curriculum/viewerContext'
import type { EnrollResult } from '@/features/enrollment/types'
import type { CurriculumLiveSessionStatus, CurriculumOutlineLesson } from '@/features/lesson/types'
import { cancelMockEnrollment, enrollMockCurriculum, getMockCurriculumDetail } from './mockCurriculumDetails'

interface CurriculumApiLiveSession {
  sessionId: string
  liveSessionStatus?: CurriculumLiveSessionStatus
  status?: CurriculumLiveSessionStatus
  scheduledAt?: string | null
}

type CurriculumApiOutlineLesson = Pick<
  CurriculumOutlineLesson,
  'lessonId' | 'title' | 'order' | 'lessonStatus'
> & Partial<Omit<CurriculumOutlineLesson, 'lessonId' | 'title' | 'order' | 'lessonStatus' | 'liveSession'>> & {
  liveSession?: CurriculumApiLiveSession | null
}

type CurriculumApiOutlineSection = Omit<CurriculumOutlineSection, 'lessons'> & {
  lessons: CurriculumApiOutlineLesson[]
}

type CurriculumApiDetailResponse = Omit<
  CurriculumDetailResponse,
  'enrollmentPolicy' | 'materials' | 'outline' | 'viewerContext'
> & {
  enrollmentPolicy?: CurriculumDetailResponse['enrollmentPolicy']
  materials?: CurriculumDetailResponse['materials']
  outline: CurriculumApiOutlineSection[]
  viewerContext?: CurriculumDetailResponse['viewerContext']
}

function normalizeLesson(lesson: CurriculumApiOutlineLesson): CurriculumOutlineLesson {
  const liveSessionStatus = lesson.liveSession?.liveSessionStatus ?? lesson.liveSession?.status
  return {
    ...lesson,
    scheduledAt: lesson.scheduledAt ?? null,
    durationMs: lesson.durationMs ?? null,
    liveSession: lesson.liveSession && liveSessionStatus
      ? {
          sessionId: lesson.liveSession.sessionId,
          status: liveSessionStatus,
          scheduledAt: lesson.liveSession.scheduledAt ?? null,
        }
      : null,
    replayStatus: lesson.replayStatus ?? 'NOT_READY',
    access: lesson.access ?? {
      allowed: false,
      destination: null,
      reasonCode: 'ENROLLMENT_REQUIRED',
    },
    learning: lesson.learning ?? null,
  }
}

export async function getCurriculumDetail(curriculumId: string, viewer?: AuthUser) {
  return requestByDataSource({
    mock: () => getMockCurriculumDetail(curriculumId),
    http: async () => {
      const { data } = await apiClient.get<CurriculumApiDetailResponse>(`/curriculums/${curriculumId}`)
      return {
        ...data,
        enrollmentPolicy: data.enrollmentPolicy ?? {
          type: 'INVITATION_ONLY' as const,
          status: 'UNAVAILABLE',
          opensAt: null,
          closesAt: null,
        },
        materials: data.materials ?? [],
        outline: data.outline.map((section) => ({
          ...section,
          lessons: section.lessons.map(normalizeLesson),
        })),
        viewerContext: data.viewerContext ?? createFallbackViewerContext(viewer),
      }
    },
  })
}

export async function enrollInCurriculum(curriculumId: string) {
  return requestByDataSource({
    mock: () => enrollMockCurriculum(curriculumId),
    http: async () => {
      const { data } = await apiClient.post<EnrollResult>(`/curriculums/${curriculumId}/enrollments`)
      return data
    },
  })
}

export async function cancelEnrollment(curriculumId: string) {
  return requestByDataSource({
    mock: () => cancelMockEnrollment(curriculumId),
    http: async () => {
      await apiClient.delete(`/curriculums/${curriculumId}/enrollments/me`)
    },
  })
}
