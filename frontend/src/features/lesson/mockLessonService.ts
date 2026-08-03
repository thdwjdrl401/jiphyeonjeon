import { getDemoCurriculumLessonNavigation, getDemoLesson } from '@/features/demo/demoData'
import {
  getMockRecordedLesson,
  mockCurriculumManagementService,
} from '@/features/curriculum/mockCurriculumManagementService'
import { findMockLesson } from '@/features/demo/mockDatabase'
import {
  publishLessonCreated,
  publishLiveScheduleChanged,
  publishLiveScheduled,
  publishMaterialPublished,
} from '@/features/notification/mockNotificationEvents'
import type { LessonService, SaveLessonRequest } from './lessonService.interface'

/**
 * 강의 저장으로 만들어야 할 알림.
 *
 * <p>저장 하나에 알림이 여러 종류 걸려 있어서(공개·일정 등록·일정 변경·자료) 판정을 저장 로직과
 * 섞으면 어느 조건에서 무엇이 나가는지 읽기 어려워진다. 조건은 여기서만 본다.
 *
 * <p><b>변경 전 상태</b>를 봐야 하므로 저장 결과가 아니라 요청과 기존 목차를 비교한다.
 */
function publishLessonSaveNotifications(request: SaveLessonRequest, lessonId: string) {
  const previous = request.lessonId ? findMockLesson(request.lessonId) : null

  if (!previous) {
    // 새 강의. 강의는 만들어지는 순간 게시 상태이므로(ADR-0005) 이 시점이 학생 공개 시점이다.
    publishLessonCreated({
      sectionId: request.sectionId,
      lessonId,
      lessonTitle: request.title,
      scheduledAt: request.scheduledAt ?? null,
    })
    return
  }

  const previousScheduledAt = previous.lesson.scheduledAt
  const nextScheduledAt = request.scheduledAt ?? null
  if (nextScheduledAt && nextScheduledAt !== previousScheduledAt) {
    if (previousScheduledAt) {
      publishLiveScheduleChanged(lessonId, {
        previousStartsAt: previousScheduledAt,
        nextStartsAt: nextScheduledAt,
      })
    } else {
      publishLiveScheduled(lessonId, nextScheduledAt)
    }
  }

  /*
    이번에 새로 올린 파일에만 자료 알림을 만든다(`materials`에는 업로드할 File만 담긴다).
    파일 수만큼 알림을 만들지 않고 한 건으로 묶는다 — 자료 5개를 한 번에 올렸을 때 학생 알림이
    5줄로 늘어나면 목록이 스스로를 반복한다.
  */
  if (request.materials.length > 0) {
    const uploadedNames = request.materials.map((file) => file.name).sort().join('|')
    publishMaterialPublished(lessonId, `mat-mock-${uploadedNames}`)
  }
}

export const mockLessonService = {
  async getLesson(request) {
    const recorded = getMockRecordedLesson(request.lessonId)
    if (recorded) {
      return {
        ...recorded,
        status: 'PUBLISHED' as const,
        deliveryType: 'RECORDED' as const,
        liveSession: null,
        replayStatus: 'NOT_READY' as const,
        learning: null,
      }
    }
    return getDemoLesson(request.lessonId, request.userId)
  },
  async getCurriculumLessonNavigation(curriculumId, role) {
    if (role === 'INSTRUCTOR') {
      const [curriculum, sections] = await Promise.all([
        mockCurriculumManagementService.getInstructorCurriculum(curriculumId),
        mockCurriculumManagementService.getCurriculumManagementStructure(curriculumId),
      ])
      return {
        curriculumId,
        title: curriculum.title,
        sections: sections.map((section) => ({
          sectionId: section.sectionId,
          title: section.title,
          lessons: section.lessons.map((lesson, index) => ({
            lessonId: lesson.lessonId,
            title: lesson.title,
            order: index + 1,
            deliveryType: lesson.deliveryType ?? 'LIVE',
          })),
        })),
      }
    }
    return getDemoCurriculumLessonNavigation(curriculumId)
  },
  async saveLesson(request) {
    if (!request.lessonId && !request.scheduledAt) {
      throw new Error('강의를 생성하려면 라이브 예정 시작 시각을 입력해야 합니다.')
    }
    const lessonId = request.lessonId ?? `lesson-mock-${Date.now()}`
    publishLessonSaveNotifications(request, lessonId)
    return {
      lessonId,
      sectionId: request.sectionId,
      title: request.title,
      description: request.description,
      status: 'PUBLISHED' as const,
    }
  },
  async deleteLessonMaterial() {
    // mock: 서버 없음 — 호출자가 로컬 목록에서 제거한다.
  },
  async prepareLessonAi() {
    if (import.meta.env.MODE === 'test') return
    await new Promise<void>((resolve) => window.setTimeout(resolve, 700))
  },
} satisfies LessonService
