import { afterEach, describe, expect, it, vi } from 'vitest'
import axios from 'axios'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

import { httpLessonService } from '@/features/lesson/httpLessonService'

/**
 * 레슨 자료 배선 회귀 (BE MATERIAL presigned + attach).
 *
 * saveLesson은 한때 자료가 있으면 첫 쓰기 전에 501로 막혔다. BE가 kind=MATERIAL presigned와
 * POST /instructor/lessons/{id}/materials를 열었으므로, 실제 3단계 업로드+연결로 나가는지,
 * getLesson이 서버 materials를 뷰로 매핑하는지 못박는다.
 */
describe('레슨 자료 API 계약', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('자료가 있으면 presigned 3단계와 연결 POST를 순서대로 호출한다', async () => {
    const created = { lessonId: 'les-9', sectionId: 'sec-1', title: '새 강의', description: '설명', status: 'PUBLISHED' }
    const ticket = {
      assetId: 'ast-1',
      uploadUrl: 'https://storage.example.com/upload',
      method: 'PUT',
      headers: { 'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation' },
      expiresAt: '2026-07-22T12:00:00Z',
    }
    const file = new File(['pptx'], '자료.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })

    const postSpy = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ data: created } as never)
      .mockResolvedValueOnce({ data: { sessionId: 'ses-9', liveSessionStatus: 'SCHEDULED' } } as never)
      .mockResolvedValueOnce({ data: ticket } as never)
      .mockResolvedValueOnce({ data: { assetId: ticket.assetId, kind: 'MATERIAL', status: 'UPLOADED' } } as never)
      .mockResolvedValueOnce({ data: { materialId: 'mat-1', assetId: ticket.assetId, fileName: '자료.pptx', status: 'READY' } } as never)
    const axiosSpy = vi.spyOn(axios, 'request').mockResolvedValue({ data: {} } as never)

    await expect(httpLessonService.saveLesson({
      sectionId: 'sec-1',
      title: '새 강의',
      description: '설명',
      scheduledAt: '2026-08-04T11:30:00.000Z',
      materials: [file],
    })).resolves.toEqual(created)

    expect(postSpy).toHaveBeenNthCalledWith(1, '/instructor/sections/sec-1/lessons', {
      title: '새 강의', description: '설명',
    })
    expect(postSpy).toHaveBeenNthCalledWith(2, `/instructor/lessons/${created.lessonId}/live-sessions`, {
      scheduledAt: '2026-08-04T11:30:00.000Z',
      entryWindowMinutes: undefined,
      expectedDurationMinutes: undefined,
    })
    expect(postSpy).toHaveBeenNthCalledWith(3, '/assets/upload-requests', {
      kind: 'MATERIAL',
      fileName: '자료.pptx',
      contentType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      fileSize: file.size,
    })
    expect(axiosSpy).toHaveBeenCalledWith({
      url: ticket.uploadUrl,
      method: 'PUT',
      headers: ticket.headers,
      data: file,
    })
    expect(postSpy).toHaveBeenNthCalledWith(4, `/assets/${ticket.assetId}/complete`)
    expect(postSpy).toHaveBeenNthCalledWith(5, `/instructor/lessons/${created.lessonId}/materials`, {
      assetId: ticket.assetId,
    })
  })

  it('자료 업로드가 실패하면 어느 파일인지·레슨은 이미 저장됐음을 알리는 에러를 던진다', async () => {
    const created = { lessonId: 'les-9', sectionId: 'sec-1', title: '새 강의', description: '설명', status: 'PUBLISHED' }
    vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ data: created } as never)
      .mockResolvedValueOnce({ data: { sessionId: 'ses-9', liveSessionStatus: 'SCHEDULED' } } as never)
      .mockRejectedValueOnce(new Error('발급 실패'))

    await expect(httpLessonService.saveLesson({
      sectionId: 'sec-1',
      title: '새 강의',
      description: '설명',
      scheduledAt: '2026-08-04T11:30:00.000Z',
      materials: [new File(['x'], '깨진.pptx')],
    })).rejects.toThrow(/레슨은 저장됐지만 자료 "깨진\.pptx"/)
  })

  it('예정 시작 시각이 없으면 레슨 생성 요청 전에 차단한다', async () => {
    const postSpy = vi.spyOn(apiClient, 'post')

    await expect(httpLessonService.saveLesson({
      sectionId: 'sec-1',
      title: '일정 없는 강의',
      description: '설명',
      materials: [],
    })).rejects.toThrow('라이브 예정 시작 시각을 입력해야 합니다.')

    expect(postSpy).not.toHaveBeenCalled()
  })

  it('getLesson은 서버 materials를 뷰로 매핑한다 (materialId→id, fileName→name, fileSize→size)', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        lessonId: 'les-1',
        sectionId: 'sec-1',
        title: '강의',
        description: '설명',
        status: 'PUBLISHED',
        materials: [{ materialId: 'mat-1', fileName: 'slides.pptx', fileSize: 3_600_000 }],
      },
    } as never)

    const view = await httpLessonService.getLesson({ lessonId: 'les-1', role: 'INSTRUCTOR' })

    expect(view.materials).toEqual([
      { id: 'mat-1', name: 'slides.pptx', size: '3.4 MB', status: 'READY' },
    ])
  })

  it('서버가 materials를 주지 않으면 빈 목록으로 매핑한다', async () => {
    vi.spyOn(apiClient, 'get').mockResolvedValue({
      data: {
        lessonId: 'les-1',
        sectionId: 'sec-1',
        title: '강의',
        description: '설명',
        status: 'PUBLISHED',
      },
    } as never)

    const view = await httpLessonService.getLesson({ lessonId: 'les-1', role: 'INSTRUCTOR' })

    expect(view.materials).toEqual([])
  })
})
