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
  /**
   * 임시 비밀번호로 들어왔고 아직 바꾸지 않았는가.
   *
   * <p>true면 화면이 비밀번호 변경 외의 이동을 막는다. 임시 비밀번호는 평문으로 메일함에 남아
   * 있으므로, 그 메일이 사는 동안 계정도 열려 있는 셈이다.
   */
  mustChangePassword: boolean
  /**
   * 운영 콘솔 접근 권한. 가입 역할(`role`)이 아니라 서버 allowlist로 로그인할 때 덧입혀진다.
   *
   * 이 값은 **메뉴를 보여줄지 정하는 표시용**이다. 실제 인가는 언제나 서버가 `/api/admin/**`에서
   * 판정하므로, 조작해도 데이터는 열리지 않는다 — 화면만 열리고 요청은 403이 된다.
   */
  isAdmin: boolean
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
