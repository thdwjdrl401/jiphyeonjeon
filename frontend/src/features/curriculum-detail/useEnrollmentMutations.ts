import { useMutation, useQueryClient } from '@tanstack/react-query'
import { cancelEnrollment, enrollInCurriculum } from './curriculumDetailService'

export function useEnrollMutation(curriculumId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => enrollInCurriculum(curriculumId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['curriculums', 'detail', curriculumId] })
    },
  })
}

export function useCancelEnrollmentMutation(curriculumId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => cancelEnrollment(curriculumId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['curriculums', 'detail', curriculumId] })
    },
  })
}
