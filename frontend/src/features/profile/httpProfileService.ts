import type { AuthUser } from '@/features/auth/types'
import { ApiError, apiClient } from '@/shared/api/client'
import type { InstructorPublicProfile, ProfileService } from './profileService.interface'
import { getProfileImageValidationError } from './profileValidation'

interface AssetUploadTicket {
  assetId: string
  uploadUrl: string
  method: string
  headers: Record<string, string>
  expiresAt: string
}

export const httpProfileService = {
  async updateProfileImage(file: File): Promise<AuthUser> {
    const validationError = getProfileImageValidationError(file)
    if (validationError) throw new ApiError(validationError, 400, 'PROFILE_IMAGE_INVALID')

    const { data: ticket } = await apiClient.post<AssetUploadTicket>('/assets/upload-requests', {
      kind: 'PROFILE_IMAGE',
      fileName: file.name,
      contentType: file.type,
      fileSize: file.size,
    })

    let uploadResponse: Response
    try {
      uploadResponse = await fetch(ticket.uploadUrl, {
        method: ticket.method,
        headers: ticket.headers,
        body: file,
      })
    } catch {
      throw new ApiError('스토리지에 연결하지 못했습니다. 네트워크를 확인해 주세요.', undefined, 'ASSET_UPLOAD_NETWORK_ERROR')
    }
    if (!uploadResponse.ok) {
      throw new ApiError('이미지 업로드에 실패했습니다. 다시 시도해 주세요.', uploadResponse.status, 'ASSET_UPLOAD_FAILED')
    }

    await apiClient.post(`/assets/${ticket.assetId}/complete`)
    const { data } = await apiClient.put<AuthUser>('/me/profile-image', { assetId: ticket.assetId })
    return data
  },
  // 강사 공개 프로필·비밀번호 변경·탈퇴 (ADR-0031). 서버가 bio를 저장 전엔 null로 주는데
  // 인터페이스·화면은 string을 기대하므로 여기서 빈 문자열로 흡수한다(경계에서 한 번).
  async getInstructorProfile(): Promise<InstructorPublicProfile> {
    const { data } = await apiClient.get<InstructorPublicProfile>('/me/instructor-profile')
    return { ...data, bio: data.bio ?? '' }
  },
  async updateInstructorProfile(profile) {
    const { data } = await apiClient.put<InstructorPublicProfile>('/me/instructor-profile', profile)
    return { ...data, bio: data.bio ?? '' }
  },
  async changePassword(request) {
    await apiClient.put('/me/password', request)
  },
  async replaceTemporaryPassword(newPassword) {
    await apiClient.put('/me/password/temporary', { newPassword })
  },
  async discardTemporaryPassword() {
    await apiClient.delete('/auth/temporary-password')
  },
  async withdrawAccount() {
    await apiClient.delete('/me')
  },
} satisfies ProfileService
