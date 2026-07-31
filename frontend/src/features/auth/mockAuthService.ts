import { ApiError } from '@/shared/api/client'
import { MOCK_INSTRUCTOR_ID, MOCK_STUDENT_ID, resetMockDatabase } from '@/features/demo/mockDatabase'
import type {
  AuthUser,
  EmailAvailability,
  LoginRequest,
  SignupRequest,
} from './types'

let currentUser: AuthUser | null = null
const initialReservedEmails = [
  'liveclass@example.com',
  'admin@liveclass.ai',
  'teacher@liveclass.ai',
]
const reservedEmails = new Set(initialReservedEmails)
/** 발급된 재설정 토큰 → 요청 이메일. 1회용이라 확인 성공 시 지운다. */
const issuedResetTokens = new Map<string, string>()
let resetTokenSequence = 0

async function wait() {
  if (import.meta.env.MODE === 'test') return
  await new Promise((resolve) => window.setTimeout(resolve, 320))
}

export function peekMockUser() {
  return currentUser
}

export function resetMockAuth() {
  currentUser = null
  resetMockDatabase()
  reservedEmails.clear()
  initialReservedEmails.forEach((email) => reservedEmails.add(email))
  issuedResetTokens.clear()
  resetTokenSequence = 0
}

export const mockAuthService = {
  async getCurrentUser() {
    await wait()
    return currentUser
  },

  async login(request: LoginRequest) {
    await wait()
    if (request.password.toLowerCase() === 'wrong') {
      throw new ApiError(
        '이메일 또는 비밀번호를 확인해 주세요.',
        401,
        'AUTH_INVALID_CREDENTIALS',
      )
    }

    const isInstructor = /teacher|instructor/i.test(request.email)
    currentUser = {
      userId: isInstructor ? MOCK_INSTRUCTOR_ID : MOCK_STUDENT_ID,
      email: request.email,
      displayName: isInstructor ? '이도현' : '김학생',
      role: isInstructor ? 'INSTRUCTOR' : 'STUDENT',
      profileImageUrl: null,
    }
    return currentUser
  },

  async signup(request: SignupRequest) {
    await wait()
    if (reservedEmails.has(request.email.toLowerCase())) {
      throw new ApiError(
        '이미 사용 중인 이메일입니다.',
        409,
        'AUTH_EMAIL_DUPLICATED',
      )
    }
    reservedEmails.add(request.email.toLowerCase())
    return {
      userId: `usr_mock_${Date.now()}`,
      email: request.email,
      displayName: request.displayName,
      role: request.role,
      profileImageUrl: null,
    } satisfies AuthUser
  },

  async checkEmail(email: string) {
    await wait()
    return {
      email,
      available: !reservedEmails.has(email.toLowerCase()),
    } satisfies EmailAvailability
  },

  async logout() {
    await wait()
    currentUser = null
  },

  // core.app_user.display_name varchar(100) NOT NULL 과 동일한 제약을 목에서도 흉내낸다.
  async updateDisplayName(displayName: string) {
    await wait()
    if (!currentUser) {
      throw new ApiError('로그인이 필요합니다.', 401, 'AUTH_UNAUTHENTICATED')
    }
    const trimmed = displayName.trim()
    if (!trimmed || trimmed.length > 100) {
      throw new ApiError(
        '닉네임은 1자 이상 100자 이하로 입력해 주세요.',
        400,
        'AUTH_DISPLAY_NAME_INVALID',
      )
    }
    currentUser = { ...currentUser, displayName: trimmed }
    return currentUser
  },

  async updateProfileImage(profileImageUrl: string) {
    await wait()
    if (!currentUser) throw new ApiError('로그인이 필요합니다.', 401, 'AUTH_SESSION_REQUIRED')
    currentUser = { ...currentUser, profileImageUrl }
    return currentUser
  },

  /**
   * 재설정 메일 발송 요청. **계정이 있든 없든 똑같이 성공한다** — 이메일이 로그인 식별자라
   * 존재 여부를 응답으로 흘리면 가입자 목록 확인 수단이 된다.
   *
   * <p>`devResetToken`은 mock에서만 돌려준다. 실제 서버는 메일로만 보내므로, 이 값에
   * 의존하는 화면 코드를 쓰면 안 된다 — mock 모드 안내 문구에서만 쓴다.
   */
  async requestPasswordReset(email: string) {
    await wait()
    const normalized = email.trim().toLowerCase()
    if (!normalized) {
      throw new ApiError('이메일을 입력해 주세요.', 400, 'AUTH_EMAIL_REQUIRED')
    }
    const token = `mock-reset-${(resetTokenSequence += 1)}`
    issuedResetTokens.set(token, normalized)
    return { devResetToken: token }
  },

  /** 토큰은 **1회용**이다. 성공하면 즉시 폐기해 같은 링크가 두 번 통하지 않는다. */
  async confirmPasswordReset({ token, newPassword }: { token: string; newPassword: string }) {
    await wait()
    if (!issuedResetTokens.has(token)) {
      throw new ApiError(
        '재설정 링크가 만료되었거나 이미 사용되었습니다. 다시 요청해 주세요.',
        410,
        'AUTH_PASSWORD_RESET_TOKEN_INVALID',
      )
    }
    if (newPassword.length < 8) {
      throw new ApiError('새 비밀번호는 8자 이상이어야 합니다.', 400, 'AUTH_PASSWORD_INVALID')
    }
    issuedResetTokens.delete(token)
  },
}
