import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { studentPaths } from '@/app/router/paths'
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
    return <Navigate to={studentPaths.prejoin(sessionId ?? '')} replace />
  }

  return <Outlet />
}
