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
} satisfies AuthService
