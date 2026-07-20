import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function RequireAuthRoute() {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'loading') {
    return <div className="route-loading" role="status"><span className="spinner" aria-hidden="true" />로그인 상태를 확인하고 있어요.</div>
  }

  if (status === 'guest') {
    const returnTo = `${location.pathname}${location.search}`
    return <Navigate to={`/login?returnTo=${encodeURIComponent(returnTo)}`} replace />
  }

  return <Outlet />
}
