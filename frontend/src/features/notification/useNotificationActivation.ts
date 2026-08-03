import { useCallback, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'
import { isNotImplemented } from '@/shared/api/notImplemented'
import { useToast } from '@/shared/ui/Toast'
import { GONE_REASON_MESSAGE } from './notificationPresentation'
import { resolveNotificationRoute } from './notificationRouting'
import { resolveNotificationTarget } from './notificationService'
import { useMarkNotificationReadMutation } from './useNotificationMutations'
import { notificationQueryKeys } from './useNotificationQueries'
import type { NotificationItem } from './types'

/**
 * 알림 클릭의 공통 동작. 드롭다운과 알림 페이지가 같은 순서를 따라야 하므로 훅으로 한 번만 쓴다.
 *
 * <ol>
 *   <li>읽음 처리 — 이동이 실패해도 읽은 사실은 남는다.</li>
 *   <li>대상 재판정 — 아직 존재하고 열람 권한이 있는지 서버에 다시 묻는다.</li>
 *   <li>목적지 계산 — 유형·리소스 id·라이브 진행 상태로 경로를 만든다.</li>
 * </ol>
 *
 * <p><b>처리 상태는 건드리지 않는다.</b> 누른 것만으로 승인·검수가 끝나지 않기 때문이다 —
 * `ACTION_REQUIRED`는 관리 화면에서 실제 행동을 했을 때만 내려간다.
 */
export function useNotificationActivation() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const queryClient = useQueryClient()
  const markAsRead = useMarkNotificationReadMutation()
  const [activatingId, setActivatingId] = useState<string | null>(null)

  const activate = useCallback(
    async (notification: NotificationItem) => {
      if (!user) return
      setActivatingId(notification.notificationId)
      try {
        // 읽음 처리 실패로 이동까지 막지 않는다 — 사용자가 원한 것은 이동이다.
        await markAsRead.mutateAsync(notification.notificationId).catch(() => undefined)

        const resolution = await resolveNotificationTarget(notification.notificationId)
        if (resolution.status === 'GONE') {
          // 서버가 처리 상태를 EXPIRED로 내렸으므로 목록을 다시 읽어 배지·상태를 맞춘다.
          queryClient.invalidateQueries({ queryKey: notificationQueryKeys.all })
          toast.warning(GONE_REASON_MESSAGE[resolution.reasonCode])
          return
        }

        const path = resolveNotificationRoute(notification.type, resolution.state, user.role)
        if (!path) {
          toast.warning('이 알림으로 이동할 수 있는 화면이 없습니다.')
          return
        }
        navigate(path)
      } catch (error) {
        toast.error(
          isNotImplemented(error)
            ? '알림 기능은 아직 준비 중입니다.'
            : '알림을 여는 중 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        )
      } finally {
        setActivatingId(null)
      }
    },
    [markAsRead, navigate, queryClient, toast, user],
  )

  return { activate, activatingId }
}
