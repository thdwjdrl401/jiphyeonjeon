import { useQuery } from '@tanstack/react-query'
import { Navigate, Outlet, useLocation, useParams } from 'react-router-dom'
import { studentPaths } from '@/app/router/paths'
import { useAuth } from '@/features/auth/AuthContext'
import { getLiveSession } from '@/features/live-session/liveSessionService'
import PageState from '@/shared/ui/PageState'

interface ClassroomNavigationState {
  prejoinSessionId?: string
}

export default function RequireStudentPrejoinRoute() {
  const { sessionId } = useParams()
  const { user } = useAuth()
  const location = useLocation()
  const navigationState = location.state as ClassroomNavigationState | null
  const completedPrejoin = Boolean(sessionId && navigationState?.prejoinSessionId === sessionId)
  const sessionQuery = useQuery({
    queryKey: ['live-session', sessionId],
    queryFn: () => getLiveSession(sessionId ?? ''),
    enabled: user?.role !== 'INSTRUCTOR' && Boolean(sessionId) && !completedPrejoin,
  })

  if (user?.role === 'INSTRUCTOR' || completedPrejoin) return <Outlet />
  if (!sessionId) return <Navigate to={studentPaths.prejoin('')} replace />
  if (sessionQuery.isPending) return <PageState title="라이브 세션 상태를 확인하는 중입니다" />

  // ENDING 중에는 HLS 지연분을 계속 보고, ENDED 후에는 종료 안내와 잠긴 상호작용을 보여준다.
  // 새로고침·재접속 때 navigation state가 사라져도 이 두 상태는 강의실을 유지해야 한다.
  if (sessionQuery.data?.status === 'ENDING' || sessionQuery.data?.status === 'ENDED') {
    return <Outlet />
  }

  return <Navigate to={studentPaths.prejoin(sessionId)} replace />
}
