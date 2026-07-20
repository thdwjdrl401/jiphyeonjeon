import { describe, expect, it, vi } from 'vitest'
import { apiClient } from './client'
import { activeDataSource, requestByDataSource, selectDataSource } from './dataSource'

describe('프론트 데이터 소스 전환', () => {
  it('테스트 모드에서는 모든 선택 헬퍼가 mock 데이터 소스를 사용한다', async () => {
    const mock = vi.fn(() => 'mock-result')
    const http = vi.fn(() => 'http-result')

    await expect(requestByDataSource({ mock, http })).resolves.toBe('mock-result')
    expect(selectDataSource('mock-service', 'http-service')).toBe('mock-service')
    expect(activeDataSource).toBe('mock')
    expect(mock).toHaveBeenCalledOnce()
    expect(http).not.toHaveBeenCalled()
  })

  it('mock 모드에서 선택 경계를 우회한 실제 요청도 차단한다', async () => {
    await expect(apiClient.get('/unexpected-network-request')).rejects.toMatchObject({
      code: 'MOCK_API_NETWORK_REQUEST_BLOCKED',
    })
  })
})
