import type { AuthUser, EmailAvailability, LoginRequest, SignupRequest } from './types'

export interface AuthService {
  getCurrentUser: () => Promise<AuthUser | null>
  login: (request: LoginRequest) => Promise<AuthUser>
  signup: (request: SignupRequest) => Promise<AuthUser>
  checkEmail: (email: string) => Promise<EmailAvailability>
  logout: () => Promise<void>
  updateDisplayName: (displayName: string) => Promise<AuthUser>
  requestPasswordReset: (email: string) => Promise<PasswordResetTicket>
  confirmPasswordReset: (request: ConfirmPasswordResetRequest) => Promise<void>
}

/**
 * 재설정 메일 발송 요청의 결과.
 *
 * <p><b>계정이 있든 없든 같은 값을 돌려준다.</b> 이 제품은 이메일이 곧 로그인 식별자라
 * (CONTRACT.md — "인증 식별자는 email"), 존재 여부가 응답으로 새면 가입자 이메일 목록을
 * 확인하는 수단이 된다. 화면도 "메일을 보냈다"만 말하고 계정 유무를 언급하지 않는다.
 *
 * <p>`devResetToken`은 <b>mock 데이터 소스에서만</b> 채워진다. 실제 서버는 토큰을 응답에
 * 담지 않고 메일로만 보낸다 — 응답에 담으면 이메일 소유 확인이라는 절차 자체가 무의미해진다.
 */
export interface PasswordResetTicket {
  devResetToken?: string
}

export interface ConfirmPasswordResetRequest {
  token: string
  newPassword: string
}
