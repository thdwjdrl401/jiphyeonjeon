import {
  completeRecordingReview,
  publishVodPublished,
} from '@/features/notification/mockNotificationEvents'
import type { ReplayService } from './replayService.interface'

const replayReviews = new Map<string, { transcript: string; published: boolean }>()

export const mockReplayService = {
  async saveReplayReview(lessonId, transcript) {
    replayReviews.set(lessonId, { transcript, published: false })
    /*
      검수 초안 저장은 "강사가 녹화본을 확인했다"는 증거다 — 녹화 알림의 처리 대기 상태를 여기서
      내린다. 알림을 눌러 화면을 연 것만으로는 내리지 않는다(그건 읽음일 뿐이다).
    */
    completeRecordingReview(lessonId)
  },
  async publishReplayReview(lessonId) {
    const current = replayReviews.get(lessonId)
    replayReviews.set(lessonId, { transcript: current?.transcript ?? '', published: true })
    completeRecordingReview(lessonId)
    // 학생 알림은 실제로 공개된 이 시점에만 만든다 — 녹화 완료만으로는 보내지 않는다.
    publishVodPublished(lessonId)
  },
  async submitReplayQuiz(_lessonId, answer) {
    return { correct: answer === 'SecurityContext' }
  },
} satisfies ReplayService
