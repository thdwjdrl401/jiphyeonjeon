import { describe, expect, it } from 'vitest'
import { apiClient } from '@/shared/api/client'
import { activeDataSource, resolveDataSource, selectDataSource } from '@/shared/api/dataSource'

describe('프론트 데이터 소스 전환', () => {
  it('테스트 모드에서는 mock 구현체를 선택한다', () => {
    expect(selectDataSource('mock-service', 'http-service')).toBe('mock-service')
    expect(activeDataSource).toBe('mock')
  })

  it('mock 모드에서 선택 경계를 우회한 실제 요청도 차단한다', async () => {
    await expect(apiClient.get('/unexpected-network-request')).rejects.toMatchObject({
      code: 'MOCK_API_NETWORK_REQUEST_BLOCKED',
    })
  })

  it.each([
    { mockApiEnabled: false, expected: 'http' },
    { mockApiEnabled: true, expected: 'mock' },
  ] as const)('환경값 하나로 전체 데이터 소스 $expected를 선택한다', ({ mockApiEnabled, expected }) => {
    expect(resolveDataSource(mockApiEnabled)).toBe(expected)
  })
})
