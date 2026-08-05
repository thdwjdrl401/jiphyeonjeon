import { Navigate } from 'react-router-dom'
import { getNotificationsPath } from '@/app/router/paths'
import GuestRedirect from '@/features/auth/GuestRedirect'
import { useAuth } from '@/features/auth/AuthContext'

/**
 * 역할 없는 알림함 경로(`/notifications`)를 그 사람의 알림함으로 넘긴다.
 *
 * <p><b>왜 이 경로가 필요한가.</b> 브라우저 푸시를 클릭하면 서비스워커가 창을 여는데, 서비스워커는
 * 로그인 세션도 역할도 모른다 — 알림 하나마다 다른 목적지를 계산하는 것은 더더욱 못 한다(그건
 * 클릭 시점에 서버가 대상을 다시 판정해야 하는 일이다). 그래서 푸시 본문에는 역할이 없는 이 경로만
 * 담고, 역할 판별은 앱이 뜬 뒤 여기서 한 번 한다.
 *
 * <p>이것이 없으면 푸시 클릭이 `*` 라우트에 걸려 <b>"페이지를 찾을 수 없습니다"</b>가 뜬다.
 * 알림을 눌렀는데 404가 뜨는 것은 알림이 깨진 것과 구별되지 않는다.
 */
export default function NotificationsRedirect() {
  const { status, user } = useAuth()

  if (status === 'loading') {
    return (
      <div className="route-loading" role="status">
        <span className="spinner" aria-hidden="true" />
        로그인 상태를 확인하고 있어요.
      </div>
    )
  }

  // 어디로 보낼지는 GuestRedirect 한 곳이 정한다(로그아웃이었나, 세션이 없었나).
  if (status === 'guest' || !user) return <GuestRedirect />

  return <Navigate to={getNotificationsPath(user.role)} replace />
}
