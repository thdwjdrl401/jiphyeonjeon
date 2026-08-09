import type { AuthUser, EmailAvailability, LoginRequest, SignupRequest } from './types'

export interface AuthService {
  getCurrentUser: () => Promise<AuthUser | null>
  login: (request: LoginRequest) => Promise<AuthUser>
  signup: (request: SignupRequest) => Promise<AuthUser>
  checkEmail: (email: string) => Promise<EmailAvailability>
  logout: () => Promise<void>
  updateDisplayName: (displayName: string) => Promise<AuthUser>
  requestPasswordReset: (email: string) => Promise<void>
}

/*
 * 비밀번호 찾기는 <b>임시 비밀번호를 메일로</b> 보낸다. 응답에는 아무것도 담기지 않는다.
 *
 * <p><b>계정이 있든 없든 같은 응답이다.</b> 이 제품은 이메일이 곧 로그인 식별자라
 * (CONTRACT.md — "인증 식별자는 email"), 존재 여부가 응답으로 새면 가입자 이메일 목록을
 * 확인하는 수단이 된다. 화면도 "메일을 보냈다"만 말하고 계정 유무를 언급하지 않는다.
 */
