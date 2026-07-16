import { ApiError, apiClient } from '@/shared/api/client'
import { isMockApiEnabled } from '@/shared/config/runtime'
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
}

export const authService = isMockApiEnabled ? mockAuthService : httpAuthService
