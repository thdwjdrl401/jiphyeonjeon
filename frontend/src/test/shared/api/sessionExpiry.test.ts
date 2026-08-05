import type { AxiosError } from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { toApiError } from '@/shared/api/client'
import { subscribeToSessionExpiry } from '@/shared/api/sessionExpiry'

function axiosError(status: number) {
  return {
    response: {
      status,
      data: { code: status === 401 ? 'AUTH_SESSION_REQUIRED' : 'FORBIDDEN', message: '요청 실패' },
    },
  } as AxiosError<{ code: string; message: string }>
}

describe('API 세션 만료 신호', () => {
  it('401 응답에서만 세션 만료를 알린다', () => {
    const listener = vi.fn()
    const unsubscribe = subscribeToSessionExpiry(listener)

    expect(toApiError(axiosError(403))).toMatchObject({ status: 403 })
    expect(listener).not.toHaveBeenCalled()

    expect(toApiError(axiosError(401))).toMatchObject({ status: 401, code: 'AUTH_SESSION_REQUIRED' })
    expect(listener).toHaveBeenCalledTimes(1)

    unsubscribe()
  })
})
