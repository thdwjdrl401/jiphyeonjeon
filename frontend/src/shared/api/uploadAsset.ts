import axios from 'axios'
import { apiClient } from './client'

/**
 * 서버가 현재 업로드를 허용하는 종류.
 * 강의 자료(MATERIAL)는 PPTX MIME만·50MiB 상한으로 강사에게 열렸다.
 */
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

  // 스토리지로 직접 보내는 요청이라 apiClient를 쓰지 않는다. apiClient를 타면 요청 인터셉터가
  // 우리 서버에서 CSRF 토큰을 받아 붙이고, withCredentials가 세션 쿠키를 스토리지 호스트로 보낸다.
  // 티켓이 지시한 URL·method·헤더 그대로만 보내는 게 맞다.
  await axios.request({
    url: ticket.uploadUrl,
    method: ticket.method,
    headers: ticket.headers,
    data: file,
  })

  const { data: asset } = await apiClient.post<UploadedAsset>(`/assets/${ticket.assetId}/complete`)
  return asset
}
