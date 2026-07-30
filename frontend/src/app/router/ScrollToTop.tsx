import { useLayoutEffect } from 'react'
import { useLocation } from 'react-router-dom'

/**
 * 라우트가 바뀌면 새 화면을 항상 맨 위에서 보여 준다.
 *
 * SPA는 화면을 바꿔도 문서 스크롤이 그대로 남는다. 그래서 목록을 한참 내려보다 상세로 들어가면
 * 상세 화면이 중간부터 보이고, 저장 후 자동 이동한 화면도 엉뚱한 위치에서 시작한다.
 *
 * <p><b>여기 한 곳에서만 처리한다.</b> 페이지마다 `useEffect(() => window.scrollTo(0, 0))`를
 * 넣으면 새 페이지가 생길 때마다 빠뜨리고, 빠뜨린 것을 화면만 봐서는 알기 어렵다.
 *
 * <p><b>`pathname`만 본다 — `search`는 보지 않는다.</b> 커리큘럼 탐색은 검색·필터 조건을 쿼리에
 * 보존한다. 쿼리가 바뀔 때마다 맨 위로 튀면 결과를 내려보며 필터를 만지는 흐름이 끊긴다.
 * 필터 변경은 "같은 화면의 내용 갱신"이지 페이지 이동이 아니다.
 *
 * <p><b>`useLayoutEffect`인 이유</b>: 브라우저가 화면을 그리기 전에 스크롤을 옮긴다. `useEffect`로
 * 두면 새 화면이 이전 스크롤 위치에서 한 프레임 그려진 뒤 위로 튀어, 깜빡임이 보인다.
 *
 * <p><b>`scrollRestoration = 'manual'`인 이유</b>: 뒤로 가기에서 브라우저가 저장해 둔 위치를
 * 되살리는데, 그 복원은 우리 초기화보다 <b>늦게</b> 일어나 초기화를 덮어쓴다. 껐어야 뒤로 가기도
 * 맨 위에서 시작한다. 지금은 위치 복원이 필요한 화면·정책이 정해져 있지 않아 모든 이동을 맨 위로
 * 통일한다 — 절반만 동작하는 복원 로직을 넣어 동작을 복잡하게 만들지 않는다. 나중에 목록 화면만
 * 복원하려면 이 값을 되돌리고 복원 대상을 명시적으로 정하면 된다.
 */
export default function ScrollToTop() {
  const { pathname } = useLocation()

  useLayoutEffect(() => {
    if (!('scrollRestoration' in window.history)) return
    const previous = window.history.scrollRestoration
    window.history.scrollRestoration = 'manual'
    return () => {
      window.history.scrollRestoration = previous
    }
  }, [])

  useLayoutEffect(() => {
    // 부드러운 스크롤이 아니라 즉시 이동한다 — 화면이 바뀌는 순간에 애니메이션이 겹치면
    // 이동이 끝나기 전에 다음 조작이 들어와 위치가 어긋난다.
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })

    /*
     * 문서가 아니라 레이아웃 안쪽이 스크롤되는 구조로 바뀌어도 버티게, 현재 떠 있는 `main`도 같이
     * 되돌린다(레이아웃마다 하나씩 있다: #main-content · #workspace-content · #lesson-content).
     * 지금은 셸에 overflow가 없어 문서가 스크롤되므로 이 줄은 보험이다.
     *
     * 채팅 로그·자막 독처럼 내부에 따로 스크롤되는 위젯은 건드리지 않는다 — 그쪽은 "맨 위"가
     * 아니라 "최신"이 기준이고, 라우트가 바뀌면 어차피 다시 마운트된다.
     */
    document.querySelectorAll('main').forEach((main) => {
      if (main.scrollTop !== 0) main.scrollTop = 0
    })
  }, [pathname])

  return null
}
