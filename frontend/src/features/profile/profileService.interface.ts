import type { AuthUser } from '@/features/auth/types'

export interface ProfileService {
  updateProfileImage: (file: File) => Promise<AuthUser>
  getInstructorProfile: () => Promise<InstructorPublicProfile>
  updateInstructorProfile: (profile: InstructorPublicProfile) => Promise<InstructorPublicProfile>
  changePassword: (request: ChangePasswordRequest) => Promise<void>
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
