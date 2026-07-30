export type UserRole = 'STUDENT' | 'INSTRUCTOR'

/**
 * 가입 유형의 화면 표기. 역할이 늘어나면 여기만 채우면 되고, 빠뜨리면 타입 검사에서 걸린다 —
 * `role === 'INSTRUCTOR' ? '강사' : '학생'` 삼항식은 새 역할을 조용히 "학생"으로 표시한다.
 */
export const USER_ROLE_LABEL: Record<UserRole, string> = {
  STUDENT: '학생',
  INSTRUCTOR: '강사',
}

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
