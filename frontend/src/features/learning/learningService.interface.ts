/**
 * 레슨 학습 상태(진도·북마크). 서버 계약: `GET /api/lessons/{lessonId}/learning-context`.
 *
 * 라이브·다시보기 양쪽이 같은 축(세션 상대 ms)을 쓰므로 화면을 가리지 않는다.
 */
export interface LearningBookmark {
  /** 세션 시작을 0으로 한 위치. 플레이어 seek과 같은 축이다. */
  sessionMs: number
  createdAt: string
}

export interface LearningProgress {
  progressPercent: number
  lastPositionMs: number
  completed: boolean
  completedAt: string | null
}

export interface LearningContext {
  lessonId: string
  /** 아직 학습 기록이 없으면 null(첫 학습). */
  progress: LearningProgress | null
  bookmarks: LearningBookmark[]
}

export interface LearningService {
  getLearningContext: (lessonId: string) => Promise<LearningContext>
}
