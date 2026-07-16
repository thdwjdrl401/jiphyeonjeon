export type UserRole = 'STUDENT' | 'INSTRUCTOR'

export interface AuthUser {
  userId: string
  loginId: string
  displayName: string
  role: UserRole
}

export interface LoginRequest {
  loginId: string
  password: string
}

export interface SignupRequest extends LoginRequest {
  displayName: string
  role: UserRole
}

export interface LoginIdAvailability {
  loginId: string
  available: boolean
}
