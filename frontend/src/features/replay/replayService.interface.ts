
export interface ReplayService {
  /*
   * 다시보기 AI 질문은 여기 없다 — liveSessionService.askReplayAi가 소유한다(ADR-0075).
   * 답변이 라이브 질문과 같은 표에 쌓이고 기록 조회도 세션 경로를 공유해서, 스트림만 다른 파일에
   * 두면 같은 대화가 두 서비스로 갈린다.
   */
  saveReplayReview: (lessonId: string, transcript: string) => Promise<void>
  /** 영상 다시보기 공개. 자막 검수 초안은 이 요청에 포함하지 않는다. */
  publishReplayReview: (lessonId: string) => Promise<void>
  submitReplayQuiz: (lessonId: string, answer: string) => Promise<{ correct: boolean }>
}
