/**
 * 레슨 학습 상태(진도). 서버 계약: `GET /api/lessons/{lessonId}/learning-context`.
 *
 * 라이브·다시보기 양쪽이 같은 축(세션 상대 ms)을 쓰므로 화면을 가리지 않는다.
 */
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
}

/**
 * 진도 갱신 요청(`PUT /api/lessons/{lessonId}/progress`).
 *
 * <p>`progressPercent`는 <b>클라이언트가 계산한다</b>(ADR-0033) — 재생 위치를 아는 쪽이
 * 브라우저다. 계산 방식은 재생 위치 비율이 아니라 <b>본 칸 수</b>다(ADR-0063) — 재생바를 끝으로
 * 끌었다고 완료가 되어서는 안 된다.
 */
export interface ProgressUpdate {
  /** 0~100. 범위를 벗어나면 서버가 400으로 거절한다. */
  progressPercent: number
  /** 이어보기 위치. 진도율과 달리 되감으면 뒤로 간다 — 다시 열었을 때 돌아갈 자리다. */
  lastPositionMs: number
  /** 순서역전 방어용. 서버는 저장값보다 뒤일 때만 반영한다. */
  clientUpdatedAt: string
}

export interface LearningService {
  getLearningContext: (lessonId: string) => Promise<LearningContext>
  updateProgress: (lessonId: string, update: ProgressUpdate) => Promise<void>
}
