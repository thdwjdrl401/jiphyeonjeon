import type { AuthUser } from '@/features/auth/types'
import { ApiError, apiClient } from '@/shared/api/client'
import type { ProfileService } from './profileService.interface'
import { getProfileImageValidationError } from './profileValidation'

interface AssetUploadTicket {
  assetId: string
  uploadUrl: string
  method: string
  headers: Record<string, string>
  expiresAt: string
}

function unavailable(): never {
  throw new ApiError(
    '이 기능의 실제 API가 아직 연결되지 않았습니다.',
    501,
    'PROFILE_HTTP_ADAPTER_UNAVAILABLE',
  )
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
  async getInstructorProfile() {
    return unavailable()
  },
  async updateInstructorProfile() {
    return unavailable()
  },
  async changePassword() {
    return unavailable()
  },
  async withdrawAccount() {
    return unavailable()
  },
} satisfies ProfileService
