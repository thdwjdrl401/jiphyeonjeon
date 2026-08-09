import axios from 'axios'
import { apiClient } from './client'

/**
 * 서버가 현재 업로드를 허용하는 종류.
 * 강의 자료(MATERIAL)는 PPTX MIME만·50MiB 상한으로 강사에게 열렸다.
 */
export type AssetKind = 'PROFILE_IMAGE' | 'THUMBNAIL' | 'MATERIAL' | 'ANNOTATION_SNAPSHOT'

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
 * 바이트 전송 진행 상황.
 *
 * `ratio`가 null일 수 있다 — 브라우저가 전체 크기를 모르면(`lengthComputable=false`) axios가
 * total을 주지 않는다. 그때 0으로 접으면 진행 바가 계속 0%에 붙어 "멈췄다"로 읽히므로,
 * 호출부가 비율 대신 전송량만 보여 주도록 null을 그대로 넘긴다.
 */
export interface UploadProgress {
  ratio: number | null
  loadedBytes: number
  totalBytes: number | null
}

/** axios 진행 이벤트를 우리 모양으로 옮긴다. 없는 값을 지어내지 않는다. */
function toUploadProgress(loaded: number, total?: number): UploadProgress {
  const totalBytes = typeof total === 'number' && total > 0 ? total : null
  return {
    ratio: totalBytes === null ? null : Math.min(1, loaded / totalBytes),
    loadedBytes: loaded,
    totalBytes,
  }
}

/**
 * 스토리지로 바이트를 직접 올린다. presigned 티켓이 지시한 URL·method·헤더 그대로만 보낸다.
 *
 * apiClient를 쓰지 않는 이유는 {@link uploadAsset} 안 주석과 같다 — 인터셉터가 CSRF 토큰과
 * 세션 쿠키를 스토리지 호스트로 흘린다.
 */
export async function putBytes(
  ticket: { uploadUrl: string; method: string; headers: Record<string, string> },
  file: File,
  onProgress?: (progress: UploadProgress) => void,
): Promise<void> {
  await axios.request({
    url: ticket.uploadUrl,
    method: ticket.method,
    headers: ticket.headers,
    data: file,
    onUploadProgress: onProgress
      ? (event) => onProgress(toUploadProgress(event.loaded, event.total))
      : undefined,
  })
}

/**
 * 파일을 스토리지에 올리고, 도메인 요청에 쓸 assetId를 돌려준다.
 *
 * 1. 서버에서 presigned 업로드 티켓을 받고
 * 2. 그 URL로 바이트를 직접 올린 뒤(우리 서버를 거치지 않는다)
 * 3. 업로드 완료를 서버에 알린다.
 *
 * 반환된 assetId를 커리큘럼 생성(`thumbnailAssetId`)이나 프로필 이미지 설정(`assetId`)에 실어 보내면 된다.
 *
 * `onProgress`는 2단계(바이트 전송)에서만 불린다. 티켓 발급과 완료 통지는 짧은 JSON 왕복이라
 * 진행이라 부를 게 없다.
 */
export async function uploadAsset(
  file: File,
  kind: AssetKind,
  onProgress?: (progress: UploadProgress) => void,
): Promise<UploadedAsset> {
  const { data: ticket } = await apiClient.post<UploadTicket>('/assets/upload-requests', {
    kind,
    fileName: file.name,
    contentType: file.type,
    fileSize: file.size,
  })

  // 스토리지로 직접 보내는 요청이라 apiClient를 쓰지 않는다. apiClient를 타면 요청 인터셉터가
  // 우리 서버에서 CSRF 토큰을 받아 붙이고, withCredentials가 세션 쿠키를 스토리지 호스트로 보낸다.
  // 티켓이 지시한 URL·method·헤더 그대로만 보내는 게 맞다.
  await putBytes(ticket, file, onProgress)

  const { data: asset } = await apiClient.post<UploadedAsset>(`/assets/${ticket.assetId}/complete`)
  return asset
}
