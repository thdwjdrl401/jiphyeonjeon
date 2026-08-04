import type {
  CurriculumDetailResponse,
  CurriculumInstructorProfile,
  CurriculumOutlineSection,
} from '@/features/curriculum/types'
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
  'enrollmentPolicy' | 'instructor' | 'materials' | 'outline' | 'viewerContext'
> & {
  enrollmentPolicy?: CurriculumDetailResponse['enrollmentPolicy']
  // 강사가 프로필을 아직 안 채웠으면 서버가 bio를 null로 준다
  // (InstructorDirectoryService.toView — 프로필 행이 없으면 null).
  instructor: Omit<CurriculumInstructorProfile, 'bio' | 'expertise'> & {
    bio?: string | null
    expertise?: string[] | null
  }
  materials?: CurriculumDetailResponse['materials']
  outline: CurriculumApiOutlineSection[]
  viewerContext?: CurriculumDetailResponse['viewerContext']
}

function normalizeLesson(lesson: CurriculumApiOutlineLesson, index: number): CurriculumOutlineLesson {
  const liveSessionStatus = lesson.liveSession?.liveSessionStatus ?? lesson.liveSession?.status
  return {
    ...lesson,
    order: index + 1,
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
      // 화면 모델은 bio를 string으로 약속한다 — mock 구현체와 같은 모양이 되게 경계에서 채운다.
      instructor: {
        ...data.instructor,
        bio: data.instructor.bio ?? '',
        expertise: data.instructor.expertise ?? [],
      },
      materials: data.materials ?? [],
      // 서버의 order는 저장용 orderIndex(0부터)다 — 화면 번호는 1부터라 경계에서 한 번만 맞춘다.
      // 관리 화면(httpCurriculumManagementService)·mock·강의 네비도 이미 1-based라 여기만 어긋나 있었다.
      // orderIndex 값에 +1 하지 않고 배열 위치로 다시 매기는 이유: 서버가 섹션·레슨을 orderIndex
      // 오름차순으로 주므로(findByCurriculumIdOrderByOrderIndexAsc·findBySectionIdInOrderByOrderIndexAsc)
      // 위치만으로 순서가 정확하고, 삭제로 orderIndex에 구멍이 나도 번호가 건너뛰지 않는다.
      outline: data.outline.map((section, sectionIndex) => ({
        ...section,
        order: sectionIndex + 1,
        lessons: section.lessons.map(normalizeLesson),
      })),
      viewerContext: data.viewerContext ?? createFallbackViewerContext(viewer),
    }
  },
} satisfies CurriculumDetailService
