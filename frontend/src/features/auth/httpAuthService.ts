import { ApiError, apiClient } from '@/shared/api/client'
import type { AuthService } from './authService.interface'
import type { AuthUser, EmailAvailability } from './types'

export const httpAuthService = {
  async getCurrentUser() {
    try {
      const { data } = await apiClient.get<AuthUser>('/auth/me')
      return data
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) return null
      throw error
    }
  },
  async login(request) {
    const { data } = await apiClient.post<AuthUser>('/auth/login', request)
    return data
  },
  async signup(request) {
    const { data } = await apiClient.post<AuthUser>('/auth/signup', request)
    return data
  },
  async checkEmail(email) {
    const { data } = await apiClient.get<EmailAvailability>('/auth/email-availability', {
      params: { email },
    })
    return data
  },
  async logout() {
    await apiClient.post('/auth/logout')
  },
  async updateDisplayName(displayName) {
    const { data } = await apiClient.put<AuthUser>('/me/display-name', { displayName })
    return data
  },
  // 비밀번호 재설정은 아직 서버에 없다(메일 발송 인프라 자체가 없음). 화면·인터페이스·mock을
  // 먼저 두고 실제 경로는 그대로 호출한다 — 서버가 생기면 이 파일은 손대지 않아도 붙는다.
  // 엔드포인트가 없는 동안의 404/405를 "준비 중"으로 번역해, 사용자가 자기 입력을 의심하지
  // 않게 한다. 이 저장소의 선례와 같은 방식이다(ADR-0030).
  async requestPasswordReset(email) {
    try {
      await apiClient.post('/auth/password-reset', { email })
    } catch (error) {
      throw translateMissingEndpoint(error)
    }
    return {}
  },
  async confirmPasswordReset(request) {
    try {
      await apiClient.post('/auth/password-reset/confirm', request)
    } catch (error) {
      throw translateMissingEndpoint(error)
    }
  },
} satisfies AuthService

const NOT_IMPLEMENTED_MESSAGE = '비밀번호 재설정은 아직 준비 중입니다. 잠시 후 다시 시도해 주세요.'

function translateMissingEndpoint(error: unknown) {
  if (error instanceof ApiError && (error.status === 404 || error.status === 405 || error.status === 501)) {
    return new ApiError(NOT_IMPLEMENTED_MESSAGE, error.status, 'PASSWORD_RESET_NOT_IMPLEMENTED')
  }
  return error
}
