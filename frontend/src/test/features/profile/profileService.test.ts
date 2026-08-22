import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

import { httpProfileService } from '@/features/profile/profileService'

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

/**
 * 강사 공개 프로필·비밀번호·탈퇴가 실제 서버 경로를 호출하는지 (ADR-0031).
 *
 * 이 4개는 한때 notImplemented(요청 없이 501)로 막혀 있었고, 서버가 생긴 뒤에도 그대로 남아
 * 화면에 "불러오지 못했습니다"만 떴다. 그때 이 테스트가 있었다면 회귀가 CI에서 잡혔다.
 * 그래서 "실제로 이 경로로 요청이 나가는가"를 확인한다.
 */
describe('계정 API 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('강사 공개 프로필을 GET하고, 서버가 준 null bio를 빈 문자열로 흡수한다', async () => {
    const getSpy = vi.spyOn(apiClient, 'get')
      .mockResolvedValue({ data: { bio: null, expertise: ['Spring'] } } as never)

    await expect(httpProfileService.getInstructorProfile())
      .resolves.toEqual({ bio: '', expertise: ['Spring'] })
    expect(getSpy).toHaveBeenCalledWith('/me/instructor-profile')
  })

  it('강사 공개 프로필을 PUT으로 저장한다', async () => {
    const putSpy = vi.spyOn(apiClient, 'put')
      .mockResolvedValue({ data: { bio: '소개', expertise: ['JPA'] } } as never)

    await expect(httpProfileService.updateInstructorProfile({ bio: '소개', expertise: ['JPA'] }))
      .resolves.toEqual({ bio: '소개', expertise: ['JPA'] })
    expect(putSpy).toHaveBeenCalledWith('/me/instructor-profile', { bio: '소개', expertise: ['JPA'] })
  })

  it('비밀번호 변경은 PUT /me/password로 나간다', async () => {
    const putSpy = vi.spyOn(apiClient, 'put').mockResolvedValue({ data: undefined } as never)

    await httpProfileService.changePassword({ currentPassword: 'old12345', newPassword: 'new12345' })
    expect(putSpy).toHaveBeenCalledWith('/me/password', { currentPassword: 'old12345', newPassword: 'new12345' })
  })

  it('회원 탈퇴는 DELETE /me로 나간다', async () => {
    const deleteSpy = vi.spyOn(apiClient, 'delete').mockResolvedValue({ data: undefined } as never)

    await httpProfileService.withdrawAccount()
    expect(deleteSpy).toHaveBeenCalledWith('/me')
  })
})
