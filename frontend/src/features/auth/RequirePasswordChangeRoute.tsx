import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import { useAuth } from './AuthContext'

/**
 * 임시 비밀번호로 들어온 사람을 비밀번호 변경 화면에 붙잡아 둔다.
 *
 * <p><b>모든 로그인 후 화면 위에 건다.</b> 개별 화면마다 검사하면 새 화면이 생길 때마다 빠뜨릴
 * 자리가 늘고, 빠뜨린 것은 조용히 열린 채로 남는다. 한 곳에서 막는 편이 잊을 자리가 없다.
 *
 * <p><b>임시 비밀번호로 들어왔을 때만 잡는다.</b> 원래 비밀번호로 들어온 사람은 바꿀 이유가 없다 —
 * 재발급은 남이 눌렀을 수도 있어서, 그 사람에게 변경을 강요하면 "요청한 적도 없는데 왜"가 된다.
 * 그 사람에게는 대신 임시 비밀번호를 폐기할지 물어본다.
 *
 * <p><b>서버가 정본이다.</b> 이 가드는 화면을 돌릴 뿐이라 URL을 직접 쳐서 지나갈 수 있다 —
 * 여기서 노리는 것은 강제이지 인가가 아니다.
 */
export default function RequirePasswordChangeRoute() {
  const { user } = useAuth()
  const location = useLocation()

  if (user?.signedInWithTemporaryPassword && location.pathname !== publicPaths.passwordChangeRequired) {
    return <Navigate to={publicPaths.passwordChangeRequired} replace />
  }

  return <Outlet />
}
