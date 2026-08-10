import type { AuthUser } from '@/features/auth/types'

export interface ProfileService {
  updateProfileImage: (file: File) => Promise<AuthUser>
  getInstructorProfile: () => Promise<InstructorPublicProfile>
  updateInstructorProfile: (profile: InstructorPublicProfile) => Promise<InstructorPublicProfile>
  changePassword: (request: ChangePasswordRequest) => Promise<void>
  /**
   * 임시 비밀번호로 로그인한 세션에서 새 비밀번호를 정한다.
   *
   * <p><b>현재 비밀번호를 받지 않는다.</b> 방금 그 값으로 로그인해 세션이 섰으므로 이미 증명된
   * 것이고, 서버도 이 경로에서만 그것을 묻지 않는다.
   */
  replaceTemporaryPassword: (newPassword: string) => Promise<void>
  /** 발급된 임시 비밀번호를 즉시 버린다. 내가 요청한 적 없는 재발급을 무르는 길이다. */
  discardTemporaryPassword: () => Promise<void>
  withdrawAccount: () => Promise<void>
}

export interface InstructorPublicProfile {
  bio: string
  expertise: string[]
}

export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}
