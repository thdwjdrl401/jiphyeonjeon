import { apiClient } from './client'
import type { LoginCredentials, LoginResponse } from '@/types/auth'

export async function requestLogin(credentials: LoginCredentials): Promise<LoginResponse> {
  const response = await apiClient.post<LoginResponse>('/auth/login', credentials)
  return response.data
}
