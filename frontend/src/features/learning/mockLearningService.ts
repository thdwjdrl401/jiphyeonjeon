import type { LearningBookmark, LearningContext, LearningProgress, LearningService } from './learningService.interface'

/** 시드 북마크의 초기 위치 — les-security 강의를 처음 열면 이미 몇 개 찍혀 있는 것처럼 보여준다. */
const SEED_BOOKMARK_SESSION_MS: Record<string, number[]> = {
  'les-security': [128_000, 742_000, 1_530_000],
}

let bookmarkSequence = 0
let bookmarksByLesson = new Map<string, LearningBookmark[]>()

function seedBookmarks() {
  bookmarksByLesson = new Map(
    Object.entries(SEED_BOOKMARK_SESSION_MS).map(([lessonId, sessionMsList]) => [
      lessonId,
      sessionMsList.map((sessionMs) => ({
        bookmarkId: `mock-bookmark-${bookmarkSequence++}`,
        sessionMs,
        createdAt: '2026-08-01T10:30:00+09:00',
      })),
    ]),
  )
}
seedBookmarks()

/**
 * liveSessionService의 목 `saveBookmark`가 여기 저장소에 직접 쓴다 — 추가 API와 조회 API가 서버에서는
 * 같은 테이블이므로, 목에서도 같은 저장소를 나눠 써야 추가한 것이 목록에 바로 보인다.
 */
export function addMockBookmark(lessonId: string, sessionMs: number) {
  const bookmarks = bookmarksByLesson.get(lessonId) ?? []
  // 서버와 같은 멱등 규칙 — 같은 위치가 이미 있으면 새로 만들지 않는다.
  if (bookmarks.some((bookmark) => bookmark.sessionMs === sessionMs)) return
  bookmarksByLesson.set(lessonId, [
    ...bookmarks,
    { bookmarkId: `mock-bookmark-${bookmarkSequence++}`, sessionMs, createdAt: new Date().toISOString() },
  ])
}

/** 서버가 완료로 치는 임계(ADR-0033). 목이 다른 값을 쓰면 목에서만 완료가 찍힌다. */
const COMPLETION_THRESHOLD_PERCENT = 90

const progressByLesson = new Map<string, LearningProgress>()

/** 테스트 사이 상태가 새지 않도록 되돌린다({@link resetMockAuth}가 함께 부른다). */
export function resetMockLearning() {
  bookmarkSequence = 0
  seedBookmarks()
  progressByLesson.clear()
}

export const mockLearningService = {
  async getLearningContext(lessonId): Promise<LearningContext> {
    return {
      lessonId,
      progress: progressByLesson.get(lessonId)
        ?? { progressPercent: 42, lastPositionMs: 742_000, completed: false, completedAt: null },
      bookmarks: [...(bookmarksByLesson.get(lessonId) ?? [])].sort((a, b) => a.sessionMs - b.sessionMs),
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
  async deleteBookmark(lessonId, bookmarkId) {
    const bookmarks = bookmarksByLesson.get(lessonId) ?? []
    bookmarksByLesson.set(lessonId, bookmarks.filter((bookmark) => bookmark.bookmarkId !== bookmarkId))
  },
} satisfies LearningService
