import { describe, expect, it, vi } from 'vitest'
import { apiClient } from './client'
import { activeDataSource, requestByDataSource, resolveDataSource, selectDataSource, shouldUseHttp } from './dataSource'

describe('프론트 데이터 소스 전환', () => {
  it('테스트 모드에서는 모든 선택 헬퍼가 mock 데이터 소스를 사용한다', async () => {
    const mock = vi.fn(() => 'mock-result')
    const http = vi.fn(() => 'http-result')

    await expect(requestByDataSource({ mock, http, apiImplemented: true })).resolves.toBe('mock-result')
    expect(selectDataSource('mock-service', 'http-service', true)).toBe('mock-service')
    expect(activeDataSource).toBe('mock')
    expect(shouldUseHttp(true)).toBe(false)
    expect(mock).toHaveBeenCalledOnce()
    expect(http).not.toHaveBeenCalled()
  })

  it('mock 모드에서 선택 경계를 우회한 실제 요청도 차단한다', async () => {
    await expect(apiClient.get('/unexpected-network-request')).rejects.toMatchObject({
      code: 'MOCK_API_NETWORK_REQUEST_BLOCKED',
    })
  })

  it.each([
    { mockApiEnabled: false, apiImplemented: true, expected: 'http' },
    { mockApiEnabled: false, apiImplemented: false, expected: 'http' },
    { mockApiEnabled: true, apiImplemented: true, expected: 'http' },
    { mockApiEnabled: true, apiImplemented: false, expected: 'mock' },
  ] as const)('환경값과 API 구현 여부에 따라 $expected를 선택한다', ({ mockApiEnabled, apiImplemented, expected }) => {
    expect(resolveDataSource({ mockApiEnabled, apiImplemented })).toBe(expected)
  })
})
