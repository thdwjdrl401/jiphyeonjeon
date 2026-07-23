import { ApiError, apiClient } from '@/shared/api/client'
import { selectDataSource } from '@/shared/api/dataSource'
import { mockAuthService } from '@/features/auth/mockAuth'
import type { AuthUser } from '@/features/auth/types'

const MAX_PROFILE_IMAGE_SIZE = 5 * 1024 * 1024
const ALLOWED_PROFILE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

interface AssetUploadTicket {
  assetId: string
  uploadUrl: string
  method: string
  headers: Record<string, string>
  expiresAt: string
}

export function getProfileImageValidationError(file: File) {
  if (!ALLOWED_PROFILE_IMAGE_TYPES.has(file.type)) {
    return 'JPG, PNG, WEBP 이미지만 등록할 수 있습니다.'
  }
  if (file.size <= 0) return '비어 있는 파일은 등록할 수 없습니다.'
  if (file.size > MAX_PROFILE_IMAGE_SIZE) return '프로필 이미지는 5MB 이하여야 합니다.'
  return null
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener('load', () => resolve(String(reader.result)))
    reader.addEventListener('error', () => reject(new Error('이미지 미리보기를 만들지 못했습니다.')))
    reader.readAsDataURL(file)
  })
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
}

export const mockProfileService = {
  async updateProfileImage(file: File): Promise<AuthUser> {
    const validationError = getProfileImageValidationError(file)
    if (validationError) throw new ApiError(validationError, 400, 'PROFILE_IMAGE_INVALID')
    return mockAuthService.updateProfileImage(await readFileAsDataUrl(file))
  },
}

export const profileService = selectDataSource(mockProfileService, httpProfileService, true)
