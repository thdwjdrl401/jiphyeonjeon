import { Navigate, Outlet } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import GuestRedirect from './GuestRedirect'
import type { UserRole } from './types'
import { useAuth } from './AuthContext'

interface RequireRoleRouteProps {
  role: UserRole
}

export default function RequireRoleRoute({ role }: RequireRoleRouteProps) {
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
  if (status === 'guest') return <GuestRedirect />

  if (user?.role !== role) {
    return <Navigate to={publicPaths.forbidden(role === 'INSTRUCTOR' ? 'instructor' : 'student')} replace />
  }

  return <Outlet />
}
