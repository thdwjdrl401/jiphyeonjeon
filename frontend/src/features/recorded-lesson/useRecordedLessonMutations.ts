import { useMutation, useQueryClient } from '@tanstack/react-query'
import { retryRecordedCaptions, retryRecordedProcessing } from './recordedLessonService'
import { recordedLessonQueryKeys } from './useRecordedLessonQueries'

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
