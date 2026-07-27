import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

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
