import { Navigate, useLocation } from 'react-router-dom'
import { publicPaths } from '@/app/router/paths'
import { useAuth } from './AuthContext'

/**
 * 로그인하지 않은 사람을 보호 경로 밖으로 내보낸다. <b>목적지를 정하는 유일한 곳이다.</b>
 *
 * <p>예전에는 이 결정이 네 군데에 흩어져 있었다 — 두 가드는 `/login?returnTo=…`으로,
 * 헤더의 로그아웃과 회원 탈퇴 모달은 각자 홈으로 보냈다. 같은 전환에서 서로 다른 곳을 가리키니
 * 어느 쪽이 마지막에 그리느냐로 결과가 갈렸고, <b>회원 탈퇴 목적지가 실행마다 달라졌다.</b>
 * 흩어진 결정은 고쳐도 다시 갈라진다 — 한 곳으로 모은다.
 *
 * <p>갈림길은 <b>왜 게스트가 되었는가</b> 하나뿐이다({@link GuestReason}).
 *
 * <ul>
 *   <li><b>never-signed-in</b> — 주소를 직접 열었거나 세션이 만료됐다. 보던 곳으로 돌아가고 싶을
 *       테니 로그인 화면으로 보내고 `returnTo`에 그 자리를 담는다.</li>
 *   <li><b>signed-out</b> — 스스로 나갔다(로그아웃·회원 탈퇴). 랜딩페이지로 보낸다. 방금 나온
 *       화면을 다시 권하는 것은 이상하고, 탈퇴한 사람에게는 돌아갈 계정조차 없다.</li>
 * </ul>
 *
 * <p>랜딩페이지는 로그인 여부로 되돌리지 않으므로 로그아웃 직전·직후 어느 쪽에서도 안전하다.
 */
export default function GuestRedirect() {
  const { guestReason } = useAuth()
  const location = useLocation()

  if (guestReason === 'signed-out') {
    return <Navigate to={publicPaths.home} replace />
  }

  const returnTo = `${location.pathname}${location.search}`
  return <Navigate to={`${publicPaths.login}?returnTo=${encodeURIComponent(returnTo)}`} replace />
}
