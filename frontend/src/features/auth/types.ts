export type UserRole = 'STUDENT' | 'INSTRUCTOR'

export interface AuthUser {
  userId: string
  email: string
  displayName: string
  role: UserRole
}

export interface LoginRequest {
  email: string
  password: string
}

export interface SignupRequest extends LoginRequest {
  displayName: string
  role: UserRole
}

export interface EmailAvailability {
  email: string
  available: boolean
}
