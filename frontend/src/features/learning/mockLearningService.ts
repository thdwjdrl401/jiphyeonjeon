import type { LearningContext, LearningProgress, LearningService } from './learningService.interface'

/** 목에서도 실제와 같은 모양을 돌려준다 — 목이 다르면 실서버에서만 깨지는 화면이 된다. */
const bookmarksByLesson = new Map<string, number[]>([
  ['les-security', [128_000, 742_000, 1_530_000]],
])

/** 서버가 완료로 치는 임계(ADR-0033). 목이 다른 값을 쓰면 목에서만 완료가 찍힌다. */
const COMPLETION_THRESHOLD_PERCENT = 90

const progressByLesson = new Map<string, LearningProgress>()

export const mockLearningService = {
  async getLearningContext(lessonId): Promise<LearningContext> {
    return {
      lessonId,
      progress: progressByLesson.get(lessonId)
        ?? { progressPercent: 42, lastPositionMs: 742_000, completed: false, completedAt: null },
      bookmarks: (bookmarksByLesson.get(lessonId) ?? []).map((sessionMs) => ({
        sessionMs,
        createdAt: '2026-08-01T10:30:00+09:00',
      })),
    }
  },
  /** 서버처럼 <b>완료는 sticky</b>다 — 한 번 임계를 넘으면 진도율이 내려가도 유지한다. */
  async updateProgress(lessonId, update) {
    const previous = progressByLesson.get(lessonId)
    const completedAt = previous?.completedAt
      ?? (update.progressPercent >= COMPLETION_THRESHOLD_PERCENT ? update.clientUpdatedAt : null)
    progressByLesson.set(lessonId, {
      progressPercent: update.progressPercent,
      lastPositionMs: update.lastPositionMs,
      completed: completedAt !== null,
      completedAt,
    })
  },
} satisfies LearningService
