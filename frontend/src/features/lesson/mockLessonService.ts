import { getDemoCurriculumLessonNavigation, getDemoLesson } from '@/features/demo/demoData'
import type { LessonService } from './lessonService.interface'

export const mockLessonService = {
  async getLesson(request) {
    return getDemoLesson(request.lessonId, request.userId)
  },
  async getCurriculumLessonNavigation(curriculumId) {
    return getDemoCurriculumLessonNavigation(curriculumId)
  },
  async saveLesson(request) {
    if (!request.lessonId && !request.scheduledAt) {
      throw new Error('강의를 생성하려면 라이브 예정 시작 시각을 입력해야 합니다.')
    }
    return {
      lessonId: request.lessonId ?? `lesson-mock-${Date.now()}`,
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
