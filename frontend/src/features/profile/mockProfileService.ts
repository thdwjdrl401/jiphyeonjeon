import { mockAuthService, peekMockUser } from '@/features/auth/mockAuthService'
import { ApiError } from '@/shared/api/client'
import type { ProfileService } from './profileService.interface'
import { getProfileImageValidationError } from './profileValidation'

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(new Error('이미지 미리보기를 만들지 못했습니다.')))
    reader.readAsDataURL(file)
  })
}

let instructorProfile = {
  bio: '실무에서 검증한 개발 경험을 라이브 수업으로 전달합니다.',
  expertise: ['Spring', 'JPA', '분산 시스템'],
}

function requireUser() {
  const user = peekMockUser()
  if (!user) throw new ApiError('로그인이 필요합니다.', 401, 'AUTH_SESSION_REQUIRED')
  return user
}

export const mockProfileService = {
  async updateProfileImage(file: File) {
    const validationError = getProfileImageValidationError(file)
    if (validationError) throw new ApiError(validationError, 400, 'PROFILE_IMAGE_INVALID')
    return mockAuthService.updateProfileImage(await readFileAsDataUrl(file))
  },
  async getInstructorProfile() {
    const user = requireUser()
    if (user.role !== 'INSTRUCTOR') {
      throw new ApiError('강사 프로필은 강사만 조회할 수 있습니다.', 403, 'INSTRUCTOR_ROLE_REQUIRED')
    }
    return { ...instructorProfile, expertise: [...instructorProfile.expertise] }
  },
  async updateInstructorProfile(profile) {
    const user = requireUser()
    if (user.role !== 'INSTRUCTOR') {
      throw new ApiError('강사 프로필은 강사만 수정할 수 있습니다.', 403, 'INSTRUCTOR_ROLE_REQUIRED')
    }
    const bio = profile.bio.trim()
    const expertise = profile.expertise.map((item) => item.trim()).filter(Boolean).slice(0, 8)
    if (!bio) throw new ApiError('강사 소개를 입력해 주세요.', 400, 'PROFILE_BIO_REQUIRED')
    instructorProfile = { bio, expertise }
    return { ...instructorProfile, expertise: [...expertise] }
  },
  async changePassword(request) {
    requireUser()
    if (request.currentPassword.toLowerCase() === 'wrong') {
      throw new ApiError('현재 비밀번호가 일치하지 않습니다.', 400, 'CURRENT_PASSWORD_MISMATCH')
    }
    if (request.newPassword.length < 8) {
      throw new ApiError('새 비밀번호는 8자 이상이어야 합니다.', 400, 'NEW_PASSWORD_INVALID')
    }
  },
  async withdrawAccount() {
    requireUser()
    await mockAuthService.logout()
  },
} satisfies ProfileService
