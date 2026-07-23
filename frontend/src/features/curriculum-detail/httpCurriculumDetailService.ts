import type { CurriculumDetailResponse, CurriculumOutlineSection } from '@/features/curriculum/types'
import { createFallbackViewerContext } from '@/features/curriculum/viewerContext'
import type { CurriculumLiveSessionStatus, CurriculumOutlineLesson } from '@/features/lesson/types'
import { apiClient } from '@/shared/api/client'
import type { CurriculumDetailService } from './curriculumDetailService.interface'

interface CurriculumApiLiveSession {
  sessionId: string
  liveSessionStatus?: CurriculumLiveSessionStatus
  status?: CurriculumLiveSessionStatus
  scheduledAt?: string | null
}

type CurriculumApiOutlineLesson = Pick<CurriculumOutlineLesson, 'lessonId' | 'title' | 'order' | 'status'> &
  Partial<Omit<CurriculumOutlineLesson, 'lessonId' | 'title' | 'order' | 'status' | 'liveSession'>> & {
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
    access: lesson.access ?? { allowed: false, destination: null, reasonCode: 'ENROLLMENT_REQUIRED' },
    learning: lesson.learning ?? null,
  }
}

export const httpCurriculumDetailService = {
  async getCurriculumDetail(curriculumId, viewer) {
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
} satisfies CurriculumDetailService
