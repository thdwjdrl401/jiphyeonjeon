import { getDemoCurriculumLessonNavigation, getDemoLesson } from '@/features/demo/demoData'
import { setMockLessonStatus } from '@/features/demo/mockDatabase'
import type { LessonService } from './lessonService.interface'

export const mockLessonService = {
  async getLesson(request) {
    return getDemoLesson(request.lessonId, request.userId)
  },
  async getCurriculumLessonNavigation(curriculumId) {
    return getDemoCurriculumLessonNavigation(curriculumId)
  },
  async saveLesson(request) {
    return {
      lessonId: request.lessonId ?? `lesson-mock-${Date.now()}`,
      sectionId: request.sectionId,
      title: request.title,
      description: request.description,
      status: 'DRAFT' as const,
    }
  },
  async deleteLessonMaterial() {
    // mock: 서버 없음 — 호출자가 로컬 목록에서 제거한다.
  },
  async prepareLessonAi() {
    if (import.meta.env.MODE === 'test') return
    await new Promise<void>((resolve) => window.setTimeout(resolve, 700))
  },
  async publishLesson(lessonId) {
    return setMockLessonStatus(lessonId, 'PUBLISHED')
  },
  async unpublishLesson(lessonId) {
    return setMockLessonStatus(lessonId, 'DRAFT')
  },
} satisfies LessonService
