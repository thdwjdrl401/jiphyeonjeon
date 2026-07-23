import type { AuthUser } from '@/features/auth/types'
import { ApiError, apiClient } from '@/shared/api/client'
import { notImplemented } from '@/shared/api/notImplemented'
import type { ProfileService } from './profileService.interface'
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
  // 강사 공개 프로필·비밀번호 변경·탈퇴는 서버에 경로가 없다. 코드는 공용 미구현 표시로 통일한다 —
  // 화면이 feature마다 다른 코드를 알 필요가 없다.
  async getInstructorProfile() {
    return notImplemented('GET /me/instructor-profile')
  },
  async updateInstructorProfile() {
    return notImplemented('PUT /me/instructor-profile')
  },
  async changePassword() {
    return notImplemented('PUT /me/password')
  },
  async withdrawAccount() {
    return notImplemented('DELETE /me')
  },
} satisfies ProfileService
