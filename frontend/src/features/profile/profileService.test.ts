import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

import { httpProfileService } from './profileService'

describe('프로필 이미지 API 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('presigned 업로드를 완료한 뒤 프로필 이미지로 연결한다', async () => {
    const file = new File(['profile-image'], 'profile.png', { type: 'image/png' })
    const updatedUser = {
      userId: 'usr-1',
      email: 'student@example.com',
      displayName: '김학생',
      role: 'STUDENT' as const,
      profileImageUrl: 'https://media.example.com/profile.png',
    }
    const ticket = {
      assetId: 'ast-1',
      uploadUrl: 'https://storage.example.com/upload',
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      expiresAt: '2026-07-22T12:00:00Z',
    }
    const postSpy = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ data: ticket } as never)
      .mockResolvedValueOnce({ data: { assetId: ticket.assetId, status: 'UPLOADED' } } as never)
    const putSpy = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: updatedUser } as never)
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(httpProfileService.updateProfileImage(file)).resolves.toEqual(updatedUser)

    expect(postSpy).toHaveBeenNthCalledWith(1, '/assets/upload-requests', {
      kind: 'PROFILE_IMAGE',
      fileName: 'profile.png',
      contentType: 'image/png',
      fileSize: file.size,
    })
    expect(fetchSpy).toHaveBeenCalledWith(ticket.uploadUrl, {
      method: 'PUT',
      headers: ticket.headers,
      body: file,
    })
    expect(postSpy).toHaveBeenNthCalledWith(2, `/assets/${ticket.assetId}/complete`)
    expect(putSpy).toHaveBeenCalledWith('/me/profile-image', { assetId: ticket.assetId })
  })

  it('지원하지 않는 이미지 형식은 업로드 요청 전에 차단한다', async () => {
    const postSpy = vi.spyOn(apiClient, 'post')
    const file = new File(['svg'], 'profile.svg', { type: 'image/svg+xml' })

    await expect(httpProfileService.updateProfileImage(file)).rejects.toThrow('JPG, PNG, WEBP 이미지만 등록할 수 있습니다.')
    expect(postSpy).not.toHaveBeenCalled()
  })
})
