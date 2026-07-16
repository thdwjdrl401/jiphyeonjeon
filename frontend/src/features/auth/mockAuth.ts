import { ApiError } from '@/shared/api/client'
import type {
  AuthUser,
  LoginIdAvailability,
  LoginRequest,
  SignupRequest,
} from './types'

let currentUser: AuthUser | null = null
const reservedLoginIds = new Set(['liveclass', 'admin', 'teacher'])

async function wait() {
  if (import.meta.env.MODE === 'test') return
  await new Promise((resolve) => window.setTimeout(resolve, 320))
}

export function peekMockUser() {
  return currentUser
}

export function resetMockAuth() {
  currentUser = null
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
        '아이디 또는 비밀번호를 확인해 주세요.',
        401,
        'AUTH_INVALID_CREDENTIALS',
      )
    }

    const isInstructor = /teacher|instructor|강사/i.test(request.loginId)
    currentUser = {
      userId: isInstructor ? 'usr_mock_instructor' : 'usr_mock_student',
      loginId: request.loginId,
      displayName: isInstructor ? '이강사' : '김학생',
      role: isInstructor ? 'INSTRUCTOR' : 'STUDENT',
    }
    return currentUser
  },

  async signup(request: SignupRequest) {
    await wait()
    if (reservedLoginIds.has(request.loginId.toLowerCase())) {
      throw new ApiError(
        '이미 사용 중인 아이디입니다.',
        409,
        'AUTH_LOGIN_ID_DUPLICATED',
      )
    }
    reservedLoginIds.add(request.loginId.toLowerCase())
    return {
      userId: `usr_mock_${Date.now()}`,
      loginId: request.loginId,
      displayName: request.displayName,
      role: request.role,
    } satisfies AuthUser
  },

  async checkLoginId(loginId: string) {
    await wait()
    return {
      loginId,
      available: !reservedLoginIds.has(loginId.toLowerCase()),
    } satisfies LoginIdAvailability
  },

  async logout() {
    await wait()
    currentUser = null
  },
}
