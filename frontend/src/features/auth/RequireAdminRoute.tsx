import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import { useAuth } from './AuthContext'

/**
 * 운영 콘솔 게이트. {@link RequireRoleRoute}와 나누는 이유는 ADMIN이 <b>가입 역할이 아니기</b> 때문이다 —
 * `UserRole`(STUDENT|INSTRUCTOR)에 ADMIN을 끼워 넣으면 가입 폼·역할 라벨·권한 판정이 한 축으로 엉킨다.
 *
 * <p>여기서 막는 것은 <b>화면</b>뿐이다. 데이터는 서버가 `/api/admin/**`에서 ROLE_ADMIN으로 따로 막는다.
 * 그래서 이 판정이 틀려도(예: 응답 조작) 열리는 것은 빈 화면이고, 요청은 403으로 떨어진다.
 */
export default function RequireAdminRoute() {
  const { status, user } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return (
      <div className="route-loading" role="status">
        <span className="spinner" aria-hidden="true" />
        로그인 상태를 확인하고 있어요.
      </div>
    )
  }

  if (status === 'guest') {
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate to={`${publicPaths.login}?returnTo=${encodeURIComponent(returnTo)}`} replace />
  }

  if (!user?.isAdmin) {
    return <Navigate to={publicPaths.forbidden()} replace />
  }

  return <Outlet />
}
