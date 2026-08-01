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

afterEach(() => {
  cleanup()
  localStorage.clear()
  sessionStorage.clear()
})
