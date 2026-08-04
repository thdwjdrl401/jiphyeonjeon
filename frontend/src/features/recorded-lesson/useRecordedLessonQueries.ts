import { useQuery } from '@tanstack/react-query'
import { getRecordedPlayback, getRecordedProcessing } from './recordedLessonService'
import { recordedProcessingPollInterval } from './recordedLessonProcessing'

export const recordedLessonQueryKeys = {
  processing: (lessonId: string) => ['recorded-processing', lessonId] as const,
  playback: (lessonId: string) => ['recorded-playback', lessonId] as const,
}

export function useRecordedProcessing(lessonId: string, enabled = true) {
  return useQuery({
    queryKey: recordedLessonQueryKeys.processing(lessonId),
    queryFn: () => getRecordedProcessing(lessonId),
    enabled: Boolean(lessonId) && enabled,
    refetchInterval: (query) => recordedProcessingPollInterval(query.state.data),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  })
}

export function useRecordedPlayback(lessonId: string, enabled: boolean) {
  return useQuery({
    queryKey: recordedLessonQueryKeys.playback(lessonId),
    queryFn: () => getRecordedPlayback(lessonId),
    enabled: Boolean(lessonId) && enabled,
    retry: false,
  })
}
