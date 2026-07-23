import { demoCaptions, demoMessages } from '@/features/demo/demoData'
import { apiClient } from '@/shared/api/client'
import { requestByDataSource } from '@/shared/api/dataSource'
import type { CaptionView, ChatMessageView } from '@/features/live-session/liveSessionService'

export function getReplayCaptions(lessonId: string) {
  return requestByDataSource<CaptionView[]>({
    mock: () => demoCaptions,
    http: async () => {
      const { data } = await apiClient.get<CaptionView[]>(`/lessons/${lessonId}/captions`)
      return data
    },
    apiImplemented: false,
  })
}

export function getReplayMessages(lessonId: string) {
  return requestByDataSource<ChatMessageView[]>({
    mock: () => demoMessages,
    http: async () => {
      const { data } = await apiClient.get<ChatMessageView[]>(`/lessons/${lessonId}/messages`)
      return data
    },
    apiImplemented: false,
  })
}

export function askReplayAi(lessonId: string, question: string, sessionMs: number) {
  return requestByDataSource<{ answer: string }>({
    mock: () => ({ answer: '세션은 인증 상태를 여러 요청에 걸쳐 유지하고, SecurityContext는 현재 요청에서 인증 주체를 참조하는 역할을 합니다.' }),
    http: async () => {
      const { data } = await apiClient.post<{ answer: string }>(`/lessons/${lessonId}/ai/questions:stream`, { question, sessionMs })
      return data
    },
    apiImplemented: false,
  })
}

export function saveReplayReview(lessonId: string, transcript: string) {
  return requestByDataSource({
    mock: () => undefined,
    http: async () => {
      await apiClient.put(`/instructor/lessons/${lessonId}/replay-review`, { transcript })
    },
    apiImplemented: false,
  })
}

export function publishReplayReview(lessonId: string, transcript: string) {
  return requestByDataSource({
    mock: () => undefined,
    http: async () => {
      await apiClient.post(`/instructor/lessons/${lessonId}/replay-review/publish`, { transcript })
    },
    apiImplemented: false,
  })
}

export function submitReplayQuiz(lessonId: string, answer: string) {
  return requestByDataSource<{ correct: boolean }>({
    mock: () => ({ correct: answer === 'SecurityContext' }),
    http: async () => {
      const { data } = await apiClient.post<{ correct: boolean }>(`/lessons/${lessonId}/quizzes/answers`, { answer })
      return data
    },
    apiImplemented: false,
  })
}
