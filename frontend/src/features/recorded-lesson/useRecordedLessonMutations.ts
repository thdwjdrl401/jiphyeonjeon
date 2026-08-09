import { useMutation, useQueryClient } from '@tanstack/react-query'
import { retryRecordedCaptions, retryRecordedProcessing, uploadRecordedVideo } from './recordedLessonService'
import { recordedLessonQueryKeys } from './useRecordedLessonQueries'

/**
 * 업로드가 끊긴 녹화강의에 원본을 다시 올린다.
 *
 * <p>성공하면 처리 상태를 바로 갈아 끼운다 — 폴링을 기다리면 방금 올린 사람이 몇 초 동안
 * `업로드가 완료되지 않아…`를 계속 본다.
 */
export function useUploadRecordedVideo(lessonId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (file: File) => uploadRecordedVideo(lessonId, file),
    onSuccess: (processing) => {
      queryClient.setQueryData(recordedLessonQueryKeys.processing(lessonId), processing)
    },
  })
}

export function useRetryRecordedProcessing(lessonId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => retryRecordedProcessing(lessonId),
    onSuccess: (processing) => {
      queryClient.setQueryData(recordedLessonQueryKeys.processing(lessonId), processing)
      queryClient.removeQueries({ queryKey: recordedLessonQueryKeys.playback(lessonId) })
    },
  })
}

export function useRetryRecordedCaptions(lessonId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => retryRecordedCaptions(lessonId),
    onSuccess: (processing) => {
      queryClient.setQueryData(recordedLessonQueryKeys.processing(lessonId), processing)
      queryClient.removeQueries({ queryKey: recordedLessonQueryKeys.playback(lessonId) })
    },
  })
}
