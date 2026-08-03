import axios from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpCurriculumManagementService } from '@/features/curriculum/httpCurriculumManagementService'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

describe('녹화강의 HTTP 업로드 계약', () => {
  afterEach(() => vi.restoreAllMocks())

  it('녹화강의 생성, presigned PUT, 완료 접수를 순서대로 수행한다', async () => {
    const post = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ data: {
        lessonId: 'lesson-1', recordedVideoId: 'recorded-1',
        deliveryType: 'RECORDED', processingStatus: 'AWAITING_UPLOAD',
      } } as never)
      .mockResolvedValueOnce({ data: {
        assetId: 'asset-1', uploadUrl: 'https://storage/upload', method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' }, expiresAt: '2026-08-03T12:00:00Z',
      } } as never)
      .mockResolvedValueOnce({ data: {
        lessonId: 'lesson-1', recordedVideoId: 'recorded-1', jobId: 'job-1', status: 'QUEUED',
      } } as never)
    const storagePut = vi.spyOn(axios, 'request').mockResolvedValue({ data: undefined } as never)
    const file = new File(['mp4-bytes'], 'lecture.mp4', { type: 'video/mp4' })

    await expect(httpCurriculumManagementService.uploadRecordedLesson({
      clientRequestId: 'client-request-1',
      curriculumId: 'curriculum-1',
      sectionId: 'section-1',
      title: '녹화강의',
      description: '설명',
      videoFile: file,
    })).resolves.toEqual({
      lessonId: 'lesson-1', recordedVideoId: 'recorded-1', jobId: 'job-1', processingStatus: 'QUEUED',
    })

    expect(post.mock.calls).toEqual([
      ['/instructor/sections/section-1/recorded-lessons', {
        clientRequestId: 'client-request-1', title: '녹화강의', description: '설명',
      }],
      ['/instructor/recorded-lessons/lesson-1/video/upload-requests', {
        fileName: 'lecture.mp4', contentType: 'video/mp4', fileSize: file.size,
      }],
      ['/instructor/recorded-lessons/lesson-1/video/complete', { assetId: 'asset-1' }],
    ])
    expect(storagePut).toHaveBeenCalledWith({
      url: 'https://storage/upload',
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      data: file,
    })
  })
})
