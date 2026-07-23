import { useMutation, useQueryClient } from '@tanstack/react-query'
import { cancelEnrollment, enrollInCurriculum, transitionEnrollment } from './enrollmentService'
import { enrollmentQueryKeys } from './useEnrollmentQueries'
import type { InstructorEnrollmentAction } from './types'

export function useEnrollMutation(curriculumId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => enrollInCurriculum(curriculumId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: enrollmentQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ['curriculums'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary', 'student'] })
    },
  })
}

export function useCancelEnrollmentMutation(curriculumId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => cancelEnrollment(curriculumId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: enrollmentQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ['curriculums'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary', 'student'] })
    },
  })
}

export function useInstructorEnrollmentTransition(curriculumId: string) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ enrollmentId, action }: {
      enrollmentId: string
      action: InstructorEnrollmentAction
    }) => transitionEnrollment(curriculumId, enrollmentId, action),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: enrollmentQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ['curriculum-management', curriculumId] })
      queryClient.invalidateQueries({ queryKey: ['curriculums'] })
    },
  })
}
