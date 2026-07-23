import { isMockApiEnabled } from '@/shared/config/runtime'

/**
 * 애플리케이션 전체 데이터 소스 선택 규칙.
 *
 * - VITE_USE_MOCK_API=true: 모든 feature가 mock 구현체 사용
 * - VITE_USE_MOCK_API=false: 모든 feature가 HTTP 구현체 사용
 * - test: runtime 설정에 의해 항상 mock
 */
export function resolveDataSource(mockApiEnabled: boolean): 'mock' | 'http' {
  return mockApiEnabled ? 'mock' : 'http'
}

export function selectDataSource<T>(mock: T, http: T): T {
  return isMockApiEnabled ? mock : http
}

export const activeDataSource = resolveDataSource(isMockApiEnabled)
