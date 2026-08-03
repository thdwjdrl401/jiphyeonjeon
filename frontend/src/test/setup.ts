import '@testing-library/jest-dom/vitest'
import { cleanup, configure } from '@testing-library/react'
import { afterEach } from 'vitest'

/**
 * `findBy*`·`waitFor`의 대기 한도. 기본값 1초는 <b>"이 기계는 한가하다"</b>는 가정인데, 우리 CI
 * 러너는 그렇지 않다 — 운영 LiveKit Egress와 <b>같은 4코어 박스</b>에 얹혀 있어서, 강의 녹화가
 * 도는 동안에는 CPU가 5~7배로 밀린다(실측 load average 27).
 *
 * <p>그때 테스트 46개가 한꺼번에 `Unable to find role=...`로 죽었다. 렌더가 안 된 것이 아니라
 * 1초 안에 못 끝난 것이다 — 같은 커밋을 같은 컨테이너에서 한가할 때 돌리면 611개가 전부 통과한다.
 *
 * <p>한도를 늘려도 <b>진짜 실패는 그대로 실패한다.</b> 없는 요소는 5초를 기다려도 없다. 늘리는 것은
 * 느린 기계에서 나는 <b>거짓 실패</b>만 없앤다. 근본은 CI와 미디어 서버를 같은 박스에 둔 배치이고,
 * 그건 인프라에서 풀어야 한다.
 */
configure({ asyncUtilTimeout: 5_000 })

// Node 22+는 globalThis.localStorage를 실험적 getter로 노출한다(--localstorage-file 없이 읽으면 undefined).
// vitest의 jsdom 환경은 "키가 이미 있다"고 보고 공개 프로퍼티를 덮어쓰지 않아, jsdom이 만든 Storage가
// Node 것에 가려진 채 전역이 비어버린다. jsdom은 백업 인스턴스를 `_localStorage`로도 노출하므로
// 그것으로 다시 붙인다. 전역이 이미 정상인 런타임(Node 20 LTS·CI)에서는 아무 일도 하지 않는다.
const storageBackups = globalThis as unknown as {
  _localStorage?: Storage
  _sessionStorage?: Storage
}

for (const key of ['localStorage', 'sessionStorage'] as const) {
  if (globalThis[key]) continue

  const backup = key === 'localStorage' ? storageBackups._localStorage : storageBackups._sessionStorage
  Object.defineProperty(globalThis, key, {
    value: backup ?? createMemoryStorage(),
    configurable: true,
    writable: true,
  })
}

/** jsdom 내부 인스턴스조차 없을 때를 위한 최소 대체품. Storage 계약 중 테스트가 쓰는 부분만 채운다. */
function createMemoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    key: (index: number) => [...entries.keys()][index] ?? null,
    getItem: (name: string) => entries.get(name) ?? null,
    setItem: (name: string, value: string) => void entries.set(name, String(value)),
    removeItem: (name: string) => void entries.delete(name),
    clear: () => entries.clear(),
  } as Storage
}

if (!window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  })
}

class TestIntersectionObserver implements IntersectionObserver {
  readonly root = null
  readonly rootMargin = '0px'
  readonly thresholds = [0]

  constructor(private readonly callback: IntersectionObserverCallback) {}

  observe(target: Element) {
    const bounds = target.getBoundingClientRect()
    this.callback(
      [
        {
          boundingClientRect: bounds,
          intersectionRatio: 1,
          intersectionRect: bounds,
          isIntersecting: true,
          rootBounds: null,
          target,
          time: performance.now(),
        },
      ],
      this,
    )
  }

  unobserve() {}

  disconnect() {}

  takeRecords() {
    return []
  }
}

if (!globalThis.IntersectionObserver) {
  Object.defineProperty(globalThis, 'IntersectionObserver', {
    configurable: true,
    writable: true,
    value: TestIntersectionObserver,
  })
}

class TestResizeObserver implements ResizeObserver {
  observe() {}

  unobserve() {}

  disconnect() {}
}

if (!globalThis.ResizeObserver) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    writable: true,
    value: TestResizeObserver,
  })
}

// jsdom에 없는 브라우저 API. 앱이 실제로 부르는 것만 최소로 채운다 — 안 채우면 매 라우트 전환마다
// "Not implemented: window.scrollTo"가 스택과 함께 찍혀(전체 실행에서 132건, 로그 ~1600줄) 진짜
// 실패가 그 속에 묻힌다. 동작을 흉내 낼 필요는 없다(스크롤 위치를 단언하는 테스트는 스스로 stub한다).
// jsdom은 이들을 "정의는 해 두고 부르면 not-implemented를 던지는" 형태로 둔다 — 그래서 존재 여부로
// 가드하면 안 되고 무조건 덮어야 한다(가드를 걸었더니 노이즈가 그대로 132건이었다).
Object.defineProperty(globalThis, 'scrollTo', {
  configurable: true,
  writable: true,
  value: () => {},
})

/*
 * jsdom은 `Element.prototype.scrollIntoView`를 아예 정의하지 않는다(window.scrollTo와 달리
 * not-implemented 스텁조차 없다). `#anchor`가 붙은 경로로 이동하면 라우팅 계층이 이 메서드를
 * 부르므로(ScrollToTop), 없으면 TypeError가 타이머 콜백에서 터져 테스트가 알 수 없는 이유로 죽는다.
 * 위치를 단언하는 테스트는 스스로 spy를 심는다.
 */
if (typeof Element !== 'undefined') {
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: () => {},
  })
}

// EgressLaserTrail이 canvas 2D 컨텍스트를 쓴다. 그리기 결과를 단언하는 테스트는 없으므로 호출만 삼킨다.
if (typeof HTMLCanvasElement !== 'undefined') {
  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: () => ({
      canvas: null,
      clearRect: () => {}, beginPath: () => {}, moveTo: () => {}, lineTo: () => {},
      stroke: () => {}, save: () => {}, restore: () => {}, setTransform: () => {},
      scale: () => {}, translate: () => {}, arc: () => {}, fill: () => {},
      createLinearGradient: () => ({ addColorStop: () => {} }),
    }),
  })
}

/**
 * 테스트가 보는 "지금"을 고정한다.
 *
 * <p>데모 fixture(`mockDatabase`)의 일정은 절대 시각이다(예: `cur-spring-live`의
 * `2026-08-03T19:00:00+09:00`). 그런데 화면 분기는 그 시각과 <b>지금</b>을 비교한다 —
 * `isLiveEntryOpen`은 `now >= scheduledAt - 10분`이면 입장을 연다. 그래서 벽시계가 그 지점을
 * 지나는 순간, "입장 가능 시간 전" 안내를 검증하는 테스트는 버튼이 링크로 바뀌며 <b>영구히</b>
 * 실패한다 — 재시도로 살릴 수 없는 시한폭탄이고, 그 시점은 2026-08-03 18:50 KST였다.
 *
 * <p>fixture를 상대 시각으로 바꾸는 길도 있지만 여러 테스트가 그 절대값을 그대로 단언한다
 * (`2026-08-03T19:00` 입력값, `오후 7:00` 표기 등). 그래서 <b>fixture는 그대로 두고 시계를
 * 고정</b>한다 — 일정과 "지금"의 관계가 시간이 지나도 변하지 않는다.
 *
 * <p>{@code Date}만 가짜로 둔다. `setTimeout` 등 실제 타이머는 살려야 스피커 테스트처럼 진짜
 * 시간을 쓰는 경로가 그대로 돈다. 개별 테스트가 `vi.useFakeTimers()`를 직접 쓰고 되돌려도
 * 매 테스트 앞에서 다시 고정하므로 영향이 남지 않는다.
 */
export const FROZEN_NOW = new Date('2026-08-01T09:00:00+09:00')

/**
 * 위 시계 고정을 이 파일(=모든 테스트)에 전역으로 걸지 <b>않는다</b>. 실제로 걸어 보니 18개가 깨졌다 —
 * 자체적으로 `vi.useFakeTimers()`를 쓰는 테스트(Toast·스피커 테스트음)와 `Date.now()`로 번호를 채는
 * 경로(판서 op 채번)가 함께 무너진다. 전역 고정은 "지금"에 의존하지 않는 테스트까지 볼모로 잡는다.
 *
 * <p>그래서 <b>fixture의 절대 일정과 "지금"을 비교하는 테스트에서만</b> 이 상수로 시계를 고정한다
 * (현재는 RouteSmoke의 입장 게이트). 필요한 곳에만 걸어 폭발 반경을 최소로 둔다.
 */

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})
