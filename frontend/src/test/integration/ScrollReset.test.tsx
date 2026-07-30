import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserRouter, Link, Outlet, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import App from '@/App'
import ScrollToTop from '@/app/router/ScrollToTop'

/**
 * 페이지를 옮기면 새 화면이 맨 위에서 시작해야 한다.
 *
 * SPA는 화면을 바꿔도 문서 스크롤이 남는다. 목록을 내려보다 상세로 들어가면 상세가 중간부터
 * 보이고, 저장 후 자동 이동한 화면도 엉뚱한 위치에서 시작한다. jsdom은 실제로 스크롤하지 않으니
 * **무엇을 호출했는지**로 검증한다.
 *
 * 함께 못 박는 것: **쿼리만 바뀔 때는 초기화하지 않는다.** 커리큘럼 탐색은 검색·필터를 쿼리에
 * 보존하므로, 필터를 만질 때마다 맨 위로 튀면 결과를 보며 조건을 바꾸는 흐름이 끊긴다.
 */

let scrollTo: ReturnType<typeof vi.fn>

beforeEach(() => {
  scrollTo = vi.fn()
  vi.stubGlobal('scrollTo', scrollTo)
  window.history.replaceState({}, '', '/')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** 실제 라우팅 구조를 흉내낸 최소 앱 — 레이아웃 안에 스크롤 대상이 될 수 있는 main을 둔다. */
function Harness() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route
          element={(
            <main id="test-main">
              <Outlet />
            </main>
          )}
        >
          <Route path="/" element={<ListScreen />} />
          <Route path="/detail" element={<h1>상세</h1>} />
          <Route path="/saved" element={<h1>저장 결과</h1>} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

function ListScreen() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  return (
    <div>
      <h1>목록</h1>
      <Link to="/detail">상세로</Link>
      <button type="button" onClick={() => navigate('/saved', { replace: true })}>저장하고 이동</button>
      <button type="button" onClick={() => setParams({ q: String(Number(params.get('q') ?? 0) + 1) })}>
        필터 변경
      </button>
    </div>
  )
}

describe('라우트 이동 시 스크롤 초기화', () => {
  it('링크로 이동하면 즉시 맨 위로 되돌린다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByRole('heading', { name: '목록' })
    scrollTo.mockClear()

    await user.click(screen.getByRole('link', { name: '상세로' }))

    await screen.findByRole('heading', { name: '상세' })
    // 부드러운 스크롤이면 이동이 끝나기 전에 다음 조작이 들어와 위치가 어긋난다.
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
  })

  it('버튼으로 자동 이동해도(replace) 맨 위로 되돌린다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByRole('heading', { name: '목록' })
    scrollTo.mockClear()

    // 저장·수정·삭제 뒤 navigate(..., { replace: true })로 되돌아가는 흐름.
    await user.click(screen.getByRole('button', { name: '저장하고 이동' }))

    await screen.findByRole('heading', { name: '저장 결과' })
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
  })

  it('브라우저 뒤로 가기도 맨 위에서 시작한다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await user.click(screen.getByRole('link', { name: '상세로' }))
    await screen.findByRole('heading', { name: '상세' })
    scrollTo.mockClear()

    window.history.back()

    await screen.findByRole('heading', { name: '목록' })
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' }))
  })

  it('브라우저가 스크롤 위치를 되살리지 못하게 막고, 정리할 때 되돌린다', () => {
    // 브라우저 복원은 우리 초기화보다 늦게 일어나 초기화를 덮어쓴다. 껐어야 뒤로 가기가 맨 위다.
    // jsdom은 scrollRestoration을 구현하지 않아 직접 심는다(구현은 없는 환경에서 건너뛴다).
    Object.defineProperty(window.history, 'scrollRestoration', {
      configurable: true, writable: true, value: 'auto',
    })

    const view = render(<Harness />)
    expect(window.history.scrollRestoration).toBe('manual')

    view.unmount()
    expect(window.history.scrollRestoration).toBe('auto')
  })

  it('scrollRestoration이 없는 브라우저에서도 이동은 초기화된다', async () => {
    // 구형 브라우저에는 이 API가 없다. 없다고 스크롤 초기화 자체가 멈추면 안 된다.
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByRole('heading', { name: '목록' })
    scrollTo.mockClear()

    await user.click(screen.getByRole('link', { name: '상세로' }))

    await screen.findByRole('heading', { name: '상세' })
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
  })

  it('레이아웃 안쪽 스크롤 컨테이너(main)도 함께 되돌린다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    const main = await screen.findByRole('main')
    // 문서가 아니라 레이아웃 안쪽이 스크롤되는 구조로 바뀌어도 버티는지 확인한다.
    Object.defineProperty(main, 'scrollTop', { configurable: true, value: 420, writable: true })

    await user.click(screen.getByRole('link', { name: '상세로' }))

    await screen.findByRole('heading', { name: '상세' })
    expect(main.scrollTop).toBe(0)
  })

  it('쿼리 파라미터만 바뀌면 위치를 유지한다', async () => {
    const user = userEvent.setup()
    render(<Harness />)
    await screen.findByRole('heading', { name: '목록' })
    scrollTo.mockClear()

    await user.click(screen.getByRole('button', { name: '필터 변경' }))

    // 검색·필터는 "같은 화면의 내용 갱신"이다. 맨 위로 튀면 결과를 보며 조건을 바꿀 수 없다.
    await waitFor(() => expect(window.location.search).toBe('?q=1'))
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('실제 앱의 라우팅 계층에 연결되어 있다', async () => {
    // 페이지별로 넣는 방식이면 새 페이지에서 빠뜨린다 — 공통 계층에 한 번 걸려 있어야 한다.
    const user = userEvent.setup()
    render(<App />)
    await screen.findByRole('heading', { level: 1 }, { timeout: 3_000 })
    scrollTo.mockClear()

    // 헤더와 푸터에 같은 이름의 링크가 있다 — 어느 쪽이든 라우트 이동이면 결과는 같다.
    await user.click(screen.getAllByRole('link', { name: '커리큘럼 탐색' })[0])

    await waitFor(() => expect(window.location.pathname).toBe('/curriculums'))
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, left: 0, behavior: 'auto' })
  })
})
