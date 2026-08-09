import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import { useAuth } from './AuthContext'

/**
 * 임시 비밀번호로 들어온 사람을 비밀번호 변경 화면에 붙잡아 둔다.
 *
 * <p><b>모든 로그인 후 화면 위에 건다.</b> 개별 화면마다 검사하면 새 화면이 생길 때마다 빠뜨릴
 * 자리가 늘고, 빠뜨린 것은 조용히 열린 채로 남는다. 한 곳에서 막는 편이 잊을 자리가 없다.
 *
 * <p><b>서버가 정본이다.</b> 이 가드는 화면을 돌릴 뿐이라 URL을 직접 쳐서 지나갈 수 있다고 보고
 * 만든다 — 실제로 막는 것은 임시 비밀번호가 살아 있는 동안에도 계정 권한이 그대로라는 사실이
 * 아니라, 사용자가 그 값을 바꾸게 만드는 것이다. 여기서 노리는 것은 강제이지 인가가 아니다.
 */
export default function RequirePasswordChangeRoute() {
  const { user } = useAuth()
  const location = useLocation()

  if (user?.mustChangePassword && location.pathname !== publicPaths.passwordChangeRequired) {
    return <Navigate to={publicPaths.passwordChangeRequired} replace />
  }

  return <Outlet />
}
