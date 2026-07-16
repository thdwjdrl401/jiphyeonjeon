import { ApiError, apiClient } from '@/shared/api/client'
import { isMockApiEnabled } from '@/shared/config/runtime'
import { mockAuthService } from './mockAuth'
import type {
  AuthUser,
  LoginIdAvailability,
  LoginRequest,
  SignupRequest,
} from './types'

const httpAuthService = {
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
  async checkLoginId(loginId: string) {
    const { data } = await apiClient.get<LoginIdAvailability>(
      '/auth/login-id-availability',
      { params: { loginId } },
    )
    return data
  },
  async logout() {
    await apiClient.post('/auth/logout')
  },
}

export const authService = isMockApiEnabled ? mockAuthService : httpAuthService
