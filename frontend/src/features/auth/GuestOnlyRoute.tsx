import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function GuestOnlyRoute() {
  const { status } = useAuth()

  if (status === 'loading') {
    return (
      <div className="route-loading" role="status">
        <span className="spinner" aria-hidden="true" />
        로그인 상태를 확인하고 있어요.
      </div>
    )
  }

  if (status === 'authenticated') return <Navigate to="/" replace />
  return <Outlet />
}
