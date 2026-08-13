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
      // 현재 비밀번호 불일치는 로그인 실패와 같은 계열(401) — 서버 계약과 코드까지 맞춘다(ADR-0031).
      throw new ApiError('현재 비밀번호가 일치하지 않습니다.', 401, 'AUTH_PASSWORD_MISMATCH')
    }
    if (request.currentPassword === request.newPassword) {
      throw new ApiError(
        '새 비밀번호는 현재 비밀번호와 다르게 입력해 주세요.',
        409,
        'AUTH_PASSWORD_UNCHANGED',
      )
    }
    if (request.newPassword.length < 8) {
      throw new ApiError('새 비밀번호는 8자 이상이어야 합니다.', 400, 'NEW_PASSWORD_INVALID')
    }
  },
  async replaceTemporaryPassword() {
    // 목에는 세션 표시가 없다. 실패할 조건이 없으므로 그대로 성공시킨다.
  },
  async discardTemporaryPassword() {
    // 목은 임시 비밀번호를 만들지 않는다 — 버릴 것도 없다.
  },
  /*
   * 탈퇴는 <b>계정만</b> 처리한다. 세션을 여기서 끊지 않는다 — 실제 어댑터(`DELETE /me`)도 그렇고,
   * 로그아웃은 호출한 화면이 `useAuth().logout()`으로 이어서 한다.
   *
   * 예전에는 여기서 곧바로 `mockAuthService.logout()`을 불러, 목에서만 <b>뮤테이션 도중에</b> 인증이
   * 사라졌다. 그러면 아직 보호 경로(`/student/profile`)에 서 있는 채로 `RequireRoleRoute`가 게스트를
   * 보고 `/login?returnTo=…` 이동을 예약해, 화면이 랜딩페이지로 옮긴 뒤에 그 예약이 덮어썼다.
   * 목이 실제와 달라서 생긴 문제였고, 그 탓에 탈퇴 목적지가 실행마다 달라 보였다.
   */
  async withdrawAccount() {
    requireUser()
  },
} satisfies ProfileService
