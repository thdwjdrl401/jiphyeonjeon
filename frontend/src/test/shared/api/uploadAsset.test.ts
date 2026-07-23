import axios from 'axios'
import { describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'
import { uploadAsset } from '@/shared/api/uploadAsset'

describe('에셋 업로드', () => {
  it('티켓 발급 → presigned 업로드 → 완료 통보 순서로 진행하고 assetId를 돌려준다', async () => {
    const file = new File(['image-bytes'], 'cover.png', { type: 'image/png' })
    const postSpy = vi.spyOn(apiClient, 'post').mockImplementation((async (url: string) => {
      if (url === '/assets/upload-requests') {
        return {
          data: {
            assetId: 'ast_1',
            uploadUrl: 'https://storage.test/bucket/ast_1?sig=abc',
            method: 'PUT',
            headers: { 'Content-Type': 'image/png' },
            expiresAt: '2026-07-22T00:10:00Z',
          },
        }
      }
      return { data: { assetId: 'ast_1', kind: 'THUMBNAIL', status: 'UPLOADED' } }
    }) as never)
    const requestSpy = vi.spyOn(axios, 'request').mockResolvedValue({ status: 200 } as never)

    await expect(uploadAsset(file, 'THUMBNAIL')).resolves.toEqual({
      assetId: 'ast_1',
      kind: 'THUMBNAIL',
      status: 'UPLOADED',
    })

    expect(postSpy).toHaveBeenNthCalledWith(1, '/assets/upload-requests', {
      kind: 'THUMBNAIL',
      fileName: 'cover.png',
      contentType: 'image/png',
      fileSize: file.size,
    })
    expect(postSpy).toHaveBeenNthCalledWith(2, '/assets/ast_1/complete')

    // 바이트는 우리 서버(apiClient)가 아니라 티켓이 준 주소로 직접 간다.
    // apiClient로 보내면 baseURL·쿠키·CSRF 헤더가 붙어 서명이 깨진다.
    expect(requestSpy).toHaveBeenCalledWith({
      url: 'https://storage.test/bucket/ast_1?sig=abc',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      data: file,
    })
  })
})
