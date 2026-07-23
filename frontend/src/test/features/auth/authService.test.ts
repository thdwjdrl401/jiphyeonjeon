import { beforeEach, describe, expect, it } from 'vitest'
import { authService } from '@/features/auth/authService'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'

describe('인증 서비스 구현체 선택', () => {
  beforeEach(() => resetMockAuth())

  it('mock 구현체와 facade가 같은 로그인 상태를 공유한다', async () => {
    const user = await mockAuthService.login({
      email: 'student01@example.com',
      password: 'password1',
    })

    await expect(authService.getCurrentUser()).resolves.toEqual(user)
  })
})
