import { ApiError, apiClient } from '@/shared/api/client'
import { selectDataSource } from '@/shared/api/dataSource'
import { mockAuthService } from './mockAuth'
import type {
  AuthUser,
  EmailAvailability,
  LoginRequest,
  SignupRequest,
} from './types'

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
  async login(request: LoginRequest) {
    const { data } = await apiClient.post<AuthUser>('/auth/login', request)
    return data
  },
  async signup(request: SignupRequest) {
    const { data } = await apiClient.post<AuthUser>('/auth/signup', request)
    return data
  },
  async checkEmail(email: string) {
    const { data } = await apiClient.get<EmailAvailability>(
      '/auth/email-availability',
      { params: { email } },
    )
    return data
  },
  async logout() {
    await apiClient.post('/auth/logout')
  },
  // 아직 백엔드에 없는 엔드포인트. /api/me/profile-image(AccountController)와 같은 축으로
  // core.app_user.display_name(varchar(100) NOT NULL)을 갱신한다고 가정한 목업 계약.
  async updateDisplayName(displayName: string) {
    const { data } = await apiClient.put<AuthUser>('/me/display-name', { displayName })
    return data
  },
}

export const authService = selectDataSource(mockAuthService, httpAuthService)
