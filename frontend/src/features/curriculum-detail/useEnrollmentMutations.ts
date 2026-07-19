import { useMutation, useQueryClient } from '@tanstack/react-query'
import { cancelEnrollment, enrollInCourse } from './courseDetailService'

export function useEnrollMutation(courseId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => enrollInCourse(courseId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['courses', 'detail', courseId] })
    },
  })
}

export function useCancelEnrollmentMutation(courseId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => cancelEnrollment(courseId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['courses', 'detail', courseId] })
    },
  })
}
