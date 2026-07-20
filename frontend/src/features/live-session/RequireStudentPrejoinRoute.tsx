import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { useAuth } from '@/features/auth/AuthContext'

interface ClassroomNavigationState {
  prejoinSessionId?: string
}

export default function RequireStudentPrejoinRoute() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const location = useLocation()

  if (user?.role === 'INSTRUCTOR') return <Outlet />

  const navigationState = location.state as ClassroomNavigationState | null
  if (!sessionId || navigationState?.prejoinSessionId !== sessionId) {
    return <Navigate to={`/live-sessions/${sessionId ?? ''}/prejoin`} replace />
  }

  return <Outlet />
}
