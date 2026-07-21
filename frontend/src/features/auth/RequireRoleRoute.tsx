import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import type { UserRole } from './types'
import { useAuth } from './AuthContext'

interface RequireRoleRouteProps {
  role: UserRole
}

export default function RequireRoleRoute({ role }: RequireRoleRouteProps) {
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

  if (user?.role !== role) {
    return <Navigate to={publicPaths.forbidden(role === 'INSTRUCTOR' ? 'instructor' : 'student')} replace />
  }

  return <Outlet />
}
