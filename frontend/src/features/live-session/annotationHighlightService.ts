import { apiClient } from '@/shared/api/client'
import { uploadAsset } from '@/shared/api/uploadAsset'

/**
 * 강조 판서 캡처 저장(ADR-0074).
 *
 * <p>이미지는 <b>우리 서버를 거치지 않는다</b> — presigned로 스토리지에 직접 올리고 `assetId`만 넘긴다.
 * PPTX 자료가 쓰는 길 그대로다. 서버는 무엇이 언제 잡혔는지만 기록한다.
 */

export interface AnnotationHighlightView {
  highlightId: string
  assetId: string
  /** 표시용 presigned GET. 만료되므로 목록을 오래 열어 두면 다시 조회해야 한다. */
  imageUrl: string | null
  /** 라이브 시작 기준 경과 ms. <b>서버가 정한다</b> — 클라이언트가 보내지 않는다. */
  sessionMs: number
  interpretedText: string | null
  indexStatus: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED'
  createdAt: string
}

/**
 * 합성 이미지를 올리고 캡처로 남긴다.
 *
 * <p>업로드가 끝난 뒤에만 저장 요청을 보낸다. 순서를 뒤집으면 나중에 AI가 읽으러 갔을 때 빈 객체를
 * 만나고, 그때는 원인을 찾기 어렵다 — 서버도 같은 이유로 업로드 미완 에셋을 거절한다.
 */
export async function captureAnnotationHighlight(
  sessionId: string,
  image: Blob,
  interpretedText?: string,
): Promise<AnnotationHighlightView> {
  // 확장자·MIME을 캡처가 만든 것에 맞춘다. 하드코딩하면 포맷을 바꿀 때 조용히 어긋난다.
  const extension = image.type === 'image/webp' ? 'webp' : image.type === 'image/jpeg' ? 'jpg' : 'png'
  const file = new File([image], `highlight-${Date.now()}.${extension}`,
    { type: image.type || 'image/webp' })
  const asset = await uploadAsset(file, 'ANNOTATION_SNAPSHOT')
  const { data } = await apiClient.post<AnnotationHighlightView>(
    `/live-sessions/${sessionId}/annotation/highlights`,
    { assetId: asset.assetId, interpretedText: interpretedText || undefined },
  )
  return data
}

/** 이 세션의 캡처 목록(강조 내역). 근거에서 뺀 것은 담기지 않는다. */
export async function listAnnotationHighlights(sessionId: string): Promise<AnnotationHighlightView[]> {
  const { data } = await apiClient.get<AnnotationHighlightView[]>(
    `/live-sessions/${sessionId}/annotation/highlights`)
  return data
}

/**
 * 근거에서 뺀다(멱등).
 *
 * <p><b>지우개와는 다른 동작이다.</b> 강조 스트로크를 지우는 것은 "슬라이드가 넘어가 화면과 안 맞는다"는
 * 뜻이지 "그 내용이 틀렸다"가 아니다. 그래서 지우개는 이 함수를 부르지 않는다.
 */
export async function removeAnnotationHighlight(sessionId: string, highlightId: string): Promise<void> {
  await apiClient.delete(`/live-sessions/${sessionId}/annotation/highlights/${highlightId}`)
}
