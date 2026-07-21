import { Navigate, Outlet } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import { useAuth } from './AuthContext'

export default function GuestOnlyRoute() {
  const { status, user } = useAuth()

  if (status === 'loading') {
    return (
      <div className="route-loading" role="status">
        <span className="spinner" aria-hidden="true" />
        로그인 상태를 확인하고 있어요.
      </div>
    )
  }

  if (status === 'authenticated' && user) return <Navigate to={publicPaths.curriculums} replace />
  return <Outlet />
}
