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
   * 이번 로그인이 임시 비밀번호로 이루어졌는가.
   *
   * <p><b>계정이 아니라 이 세션의 성질이다.</b> 같은 계정이라도 원래 비밀번호로 들어오면 false다 —
   * 원래 비밀번호를 아는 사람은 바꿀 이유가 없고, 재발급은 남이 눌렀을 수도 있다.
   *
   * <p>true면 화면이 비밀번호 변경 외의 이동을 막는다.
   */
  signedInWithTemporaryPassword: boolean
  /**
   * 지금 쓸 수 있는 임시 비밀번호가 발급돼 있는가(계정의 성질).
   *
   * <p>원래 비밀번호로 들어온 사람에게 "폐기하시겠습니까"를 묻는 데 쓴다 — 내가 요청한 적 없는
   * 재발급을 그 자리에서 무를 수 있어야 한다.
   */
  temporaryPasswordActive: boolean
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
