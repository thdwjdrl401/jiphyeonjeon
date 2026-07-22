export type UserRole = 'STUDENT' | 'INSTRUCTOR'

export interface AuthUser {
  userId: string
  email: string
  displayName: string
  role: UserRole
  /** 업로드한 프로필 이미지의 표시 URL. 미설정이면 null. */
  profileImageUrl: string | null
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
