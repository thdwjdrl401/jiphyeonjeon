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
}
