import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function RequireInstructorRoute() {
  const { user } = useAuth()
  if (user?.role !== 'INSTRUCTOR') return <Navigate to="/forbidden?reason=instructor" replace />
  return <Outlet />
}
