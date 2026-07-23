import type { AuthUser, EmailAvailability, LoginRequest, SignupRequest } from './types'

export interface AuthService {
  getCurrentUser: () => Promise<AuthUser | null>
  login: (request: LoginRequest) => Promise<AuthUser>
  signup: (request: SignupRequest) => Promise<AuthUser>
  checkEmail: (email: string) => Promise<EmailAvailability>
  logout: () => Promise<void>
  updateDisplayName: (displayName: string) => Promise<AuthUser>
}
