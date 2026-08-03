import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError } from '@/shared/api/client'
import { useToast } from '@/shared/ui/Toast'
import { markAllNotificationsAsRead, markNotificationAsRead } from './notificationService'
import { notificationQueryKeys } from './useNotificationQueries'

function failureMessage(error: unknown, fallback: string) {
  return error instanceof ApiError && error.message ? error.message : fallback
}

/**
 * 개별 읽음 처리.
 *
 * <p><b>성공 토스트를 내지 않는다.</b> 읽음은 알림을 누른 결과로 따라오는 부수 효과이고, 그 직후
 * 화면이 이동한다 — 토스트까지 뜨면 사용자가 방금 한 행동(이동)과 무관한 알림이 겹친다.
 */
export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (notificationId: string) => markNotificationAsRead(notificationId),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all })
    },
  })
}

export function useMarkAllNotificationsReadMutation() {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: markAllNotificationsAsRead,
    onSuccess: () => toast.success('모든 알림을 읽음으로 처리했습니다.'),
    onError: (error) => toast.error(failureMessage(error, '알림을 읽음으로 처리하지 못했습니다.')),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all })
    },
  })
}
