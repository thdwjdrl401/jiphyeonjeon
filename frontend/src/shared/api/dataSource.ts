import { isMockApiEnabled, isTestMode } from '@/shared/config/runtime'

interface DataSourceRequests<T> {
  mock: () => T | Promise<T>
  http: () => T | Promise<T>
  /** 실제 백엔드 엔드포인트까지 구현된 기능인지 여부. */
  apiImplemented: boolean
}

/**
 * 데이터 소스 선택 규칙.
 *
 * - test: 항상 mock(네트워크 없는 결정적 테스트)
 * - VITE_USE_MOCK_API=false: 구현 여부와 무관하게 HTTP 요청
 * - VITE_USE_MOCK_API=true: 구현된 API는 HTTP, 미구현 API만 mock
 */
export function shouldUseHttp(apiImplemented: boolean) {
  return resolveDataSource({ apiImplemented, mockApiEnabled: isMockApiEnabled, testMode: isTestMode }) === 'http'
}

export function resolveDataSource({
  apiImplemented,
  mockApiEnabled,
  testMode = false,
}: {
  apiImplemented: boolean
  mockApiEnabled: boolean
  testMode?: boolean
}): 'mock' | 'http' {
  if (testMode) return 'mock'
  return !mockApiEnabled || apiImplemented ? 'http' : 'mock'
}

export function requestByDataSource<T>({ mock, http, apiImplemented }: DataSourceRequests<T>): Promise<T> {
  return Promise.resolve(shouldUseHttp(apiImplemented) ? http() : mock())
}

export function selectDataSource<T>(mock: T, http: T, apiImplemented: boolean): T {
  return shouldUseHttp(apiImplemented) ? http : mock
}

export const activeDataSource = isTestMode ? 'mock' : isMockApiEnabled ? 'hybrid' : 'http'
