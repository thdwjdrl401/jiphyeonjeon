import type { LearningContext, LearningService } from './learningService.interface'

/** 목에서도 실제와 같은 모양을 돌려준다 — 목이 다르면 실서버에서만 깨지는 화면이 된다. */
const bookmarksByLesson = new Map<string, number[]>([
  ['les-security', [128_000, 742_000, 1_530_000]],
])

export const mockLearningService = {
  async getLearningContext(lessonId): Promise<LearningContext> {
    return {
      lessonId,
      progress: { progressPercent: 42, lastPositionMs: 742_000, completed: false, completedAt: null },
      bookmarks: (bookmarksByLesson.get(lessonId) ?? []).map((sessionMs) => ({
        sessionMs,
        createdAt: '2026-08-01T10:30:00+09:00',
      })),
    }
  },
} satisfies LearningService
