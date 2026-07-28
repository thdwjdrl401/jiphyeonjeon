import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { useToast } from '@/shared/ui/Toast'
import { cancelEnrollment, enrollInCurriculum, transitionEnrollment } from './enrollmentService'
import { enrollmentQueryKeys } from './useEnrollmentQueries'
import type { InstructorEnrollmentAction } from './types'

/**
 * 수강 상태 변경의 결과 알림은 훅에서 낸다 — 같은 뮤테이션을 상세·목록·관리 화면이 함께 쓰는데,
 * 화면마다 성공/실패 처리를 따로 두면 어디선 알림이 뜨고 어디선 조용한 불일치가 생긴다.
 * 서버가 이유를 담아 주는 실패(ApiError)는 그 메시지를 그대로 보여 준다.
 */
function failureMessage(error: unknown, fallback: string) {
  return error instanceof ApiError && error.message ? error.message : fallback
}

const transitionLabel: Record<InstructorEnrollmentAction, string> = {
  approve: '수강을 승인했습니다.',
  reject: '수강 신청을 거절했습니다.',
  revoke: '수강생을 제적했습니다.',
}

export function useEnrollMutation(curriculumId: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => enrollInCurriculum(curriculumId),
    onSuccess: (enrollment) => {
      // 승인제면 바로 수강이 시작되지 않는다 — 다음에 무엇을 기다려야 하는지까지 알린다.
      toast.success(enrollment.status === 'ACTIVE'
        ? '수강 신청이 완료됐어요. 바로 학습을 시작할 수 있습니다.'
        : '수강 신청이 접수됐어요. 강사 승인 후 학습을 시작할 수 있습니다.')
    },
    onError: (error) => toast.error(failureMessage(error, '수강 신청에 실패했습니다. 잠시 후 다시 시도해 주세요.')),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: enrollmentQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ['curriculums'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary', 'student'] })
    },
  })
}

export function useCancelEnrollmentMutation(curriculumId: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: () => cancelEnrollment(curriculumId),
    onSuccess: () => toast.success('수강 신청을 취소했습니다.'),
    onError: (error) => toast.error(failureMessage(error, '수강 신청을 취소하지 못했습니다. 잠시 후 다시 시도해 주세요.')),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: enrollmentQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ['curriculums'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard-summary', 'student'] })
    },
  })
}

export function useInstructorEnrollmentTransition(curriculumId: string) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ enrollmentId, action }: {
      enrollmentId: string
      action: InstructorEnrollmentAction
    }) => transitionEnrollment(curriculumId, enrollmentId, action),
    onSuccess: (_result, { action }) => toast.success(transitionLabel[action]),
    onError: (error) => toast.error(failureMessage(error, '수강 상태를 변경하지 못했습니다. 잠시 후 다시 시도해 주세요.')),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: enrollmentQueryKeys.all })
      queryClient.invalidateQueries({ queryKey: ['curriculum-management', curriculumId] })
      queryClient.invalidateQueries({ queryKey: ['curriculums'] })
    },
  })
}
