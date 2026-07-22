import axios from 'axios'
import { apiClient } from './client'

export type AssetKind = 'PROFILE_IMAGE' | 'THUMBNAIL' | 'MATERIAL'

interface UploadTicket {
  assetId: string
  uploadUrl: string
  method: string
  headers: Record<string, string>
  expiresAt: string
}

export interface UploadedAsset {
  assetId: string
  kind: AssetKind
  status: string
}

/**
 * 파일을 스토리지에 올리고, 도메인 요청에 쓸 assetId를 돌려준다.
 *
 * 1. 서버에서 presigned 업로드 티켓을 받고
 * 2. 그 URL로 바이트를 직접 올린 뒤(우리 서버를 거치지 않는다)
 * 3. 업로드 완료를 서버에 알린다.
 *
 * 반환된 assetId를 커리큘럼 생성(`thumbnailAssetId`)이나 프로필 이미지 설정(`assetId`)에 실어 보내면 된다.
 */
export async function uploadAsset(file: File, kind: AssetKind): Promise<UploadedAsset> {
  const { data: ticket } = await apiClient.post<UploadTicket>('/assets/upload-requests', {
    kind,
    fileName: file.name,
    contentType: file.type,
    fileSize: file.size,
  })

  // presigned URL은 서명이 걸린 스토리지 주소다. apiClient로 보내면 baseURL(/api)·쿠키·CSRF 헤더가
  // 함께 붙어 서명이 깨지므로, 설정이 없는 axios 인스턴스로 티켓이 지시한 그대로만 보낸다.
  await axios.request({
    url: ticket.uploadUrl,
    method: ticket.method,
    headers: ticket.headers,
    data: file,
  })

  const { data: asset } = await apiClient.post<UploadedAsset>(`/assets/${ticket.assetId}/complete`)
  return asset
}
