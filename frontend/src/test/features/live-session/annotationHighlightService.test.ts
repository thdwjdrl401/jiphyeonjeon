import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

const uploadAsset = vi.fn()
vi.mock('@/shared/api/uploadAsset', () => ({ uploadAsset: (...args: unknown[]) => uploadAsset(...args) }))

import {
  captureAnnotationHighlight,
  listAnnotationHighlights,
  removeAnnotationHighlight,
} from '@/features/live-session/annotationHighlightService'

/**
 * 강조 판서 캡처 저장 계약(ADR-0074).
 *
 * <p>여기서 고정하는 것: 이미지는 <b>에셋으로 먼저 올리고 assetId만</b> 넘긴다(PPTX와 같은 길),
 * 그리고 <b>sessionMs를 보내지 않는다</b> — 서버가 정한다. 클라이언트가 시각을 보내기 시작하면
 * 다시보기 앵커가 영상과 어긋나는데, 그 어긋남은 나중에 근거를 눌렀을 때만 드러난다.
 */
describe('강조 판서 캡처 저장', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    uploadAsset.mockReset()
  })

  it('이미지를 ANNOTATION_SNAPSHOT 에셋으로 올린 뒤 assetId만 보낸다', async () => {
    uploadAsset.mockResolvedValue({ assetId: 'asset-1', kind: 'ANNOTATION_SNAPSHOT', status: 'UPLOADED' })
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: { highlightId: 'h1' } } as never)

    await captureAnnotationHighlight('ses-1', new Blob(['x'], { type: 'image/png' }), '핵심')

    expect(uploadAsset).toHaveBeenCalledWith(expect.any(File), 'ANNOTATION_SNAPSHOT')
    expect(post).toHaveBeenCalledWith(
      '/live-sessions/ses-1/annotation/highlights',
      { assetId: 'asset-1', interpretedText: '핵심' },
    )
  })

  it('시각(sessionMs)은 보내지 않는다 — 서버가 정한다', async () => {
    uploadAsset.mockResolvedValue({ assetId: 'asset-2', kind: 'ANNOTATION_SNAPSHOT', status: 'UPLOADED' })
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: {} } as never)

    await captureAnnotationHighlight('ses-1', new Blob(['x'], { type: 'image/png' }))

    const body = post.mock.calls[0][1] as Record<string, unknown>
    expect(body).not.toHaveProperty('sessionMs')
    // 해석 텍스트가 없으면 필드를 비워 보낸다(빈 문자열이 아니라).
    expect(body.interpretedText).toBeUndefined()
  })

  it('업로드가 실패하면 저장 요청을 보내지 않는다', async () => {
    uploadAsset.mockRejectedValue(new Error('업로드 실패'))
    const post = vi.spyOn(apiClient, 'post')

    await expect(captureAnnotationHighlight('ses-1', new Blob(['x']))).rejects.toThrow()
    expect(post).not.toHaveBeenCalled()
  })

  it('목록과 제외는 세션 범위 경로를 쓴다', async () => {
    const get = vi.spyOn(apiClient, 'get').mockResolvedValue({ data: [] } as never)
    const del = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: undefined } as never)

    await listAnnotationHighlights('ses-1')
    await removeAnnotationHighlight('ses-1', 'h1')

    expect(get).toHaveBeenCalledWith('/live-sessions/ses-1/annotation/highlights')
    expect(del).toHaveBeenCalledWith('/live-sessions/ses-1/annotation/highlights/h1')
  })
})
