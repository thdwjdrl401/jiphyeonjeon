import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))
// 바이트는 스토리지로 직접 나간다 — 여기서는 진행 보고의 순서·내용만 본다.
vi.mock('@/shared/api/uploadAsset', () => ({
  uploadAsset: vi.fn(async (file: File, _kind: string, onProgress?: (p: unknown) => void) => {
    onProgress?.({ ratio: 0.5, loadedBytes: file.size / 2, totalBytes: file.size })
    onProgress?.({ ratio: 1, loadedBytes: file.size, totalBytes: file.size })
    return { assetId: `asset-${file.name}`, kind: 'MATERIAL', status: 'UPLOADED' }
  }),
  putBytes: vi.fn(async (_ticket: unknown, file: File, onProgress?: (p: unknown) => void) => {
    onProgress?.({ ratio: 0.25, loadedBytes: file.size / 4, totalBytes: file.size })
    onProgress?.({ ratio: 1, loadedBytes: file.size, totalBytes: file.size })
  }),
}))

import { httpCurriculumManagementService } from '@/features/curriculum/httpCurriculumManagementService'
import type { RecordedUploadProgress } from '@/features/curriculum/curriculumManagementService.interface'

/**
 * 녹화강의 업로드는 레슨 생성 → 자료 → 영상 → 처리 요청의 4단계인데, 예전에는 전부 하나의 await에
 * 묶여 있어 화면이 "업로드 중…" 한 줄만 띄웠다. 어느 단계에서 멈췄는지 알 수 없었다.
 */
describe('녹화강의 업로드 진행 보고', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  function stubApi() {
    vi.spyOn(apiClient, 'post').mockImplementation(async (url: string) => {
      if (url.endsWith('/recorded-lessons')) {
        return { data: { lessonId: 'les-1', recordedVideoId: 'vid-1', deliveryType: 'RECORDED', processingStatus: 'AWAITING_UPLOAD' } } as never
      }
      if (url.endsWith('/video/upload-requests')) {
        return { data: { assetId: 'asset-video', uploadUrl: 'https://storage/put', method: 'PUT', headers: {}, expiresAt: '' } } as never
      }
      if (url.endsWith('/video/complete')) {
        return { data: { lessonId: 'les-1', recordedVideoId: 'vid-1', jobId: 'job-1', status: 'QUEUED' } } as never
      }
      return { data: { materialId: 'mat-1' } } as never
    })
  }

  const request = (onProgress: (p: RecordedUploadProgress) => void, materials: File[]) => ({
    clientRequestId: 'req-1',
    curriculumId: 'cur-1',
    sectionId: 'sec-1',
    title: '녹화 1강',
    description: '',
    videoFile: new File(['x'.repeat(100)], 'lecture.mp4', { type: 'video/mp4' }),
    materials,
    onProgress,
  })

  it('네 단계를 순서대로 보고한다', async () => {
    stubApi()
    const seen: RecordedUploadProgress[] = []

    await httpCurriculumManagementService.uploadRecordedLesson(
      request((progress) => seen.push(progress), [new File(['a'], 'deck.pptx')]),
    )

    // 중복을 접은 단계 순서. 자료가 영상보다 먼저다 — 자료가 실패하면 영상은 AWAITING_UPLOAD에
    // 남아 같은 멱등키로 이어서 재시도할 수 있다.
    const stages = seen.map((progress) => progress.stage).filter((stage, index, all) => stage !== all[index - 1])
    expect(stages).toEqual([
      'CREATING_LESSON',
      'UPLOADING_MATERIALS',
      'UPLOADING_VIDEO',
      'REQUESTING_PROCESSING',
    ])
  })

  it('영상 전송 비율을 그대로 흘려보낸다', async () => {
    stubApi()
    const seen: RecordedUploadProgress[] = []

    await httpCurriculumManagementService.uploadRecordedLesson(request((p) => seen.push(p), []))

    // 업로드 시간의 거의 전부가 이 단계다. 여기서 비율이 안 오면 진행 막대가 의미를 잃는다.
    const videoRatios = seen.filter((p) => p.stage === 'UPLOADING_VIDEO').map((p) => p.ratio)
    expect(videoRatios).toContain(0.25)
    expect(videoRatios).toContain(1)
  })

  it('자료마다 몇 번째인지와 파일 이름을 함께 보고한다', async () => {
    stubApi()
    const seen: RecordedUploadProgress[] = []

    await httpCurriculumManagementService.uploadRecordedLesson(request(
      (p) => seen.push(p),
      [new File(['a'], 'a.pptx'), new File(['b'], 'b.pptx')],
    ))

    // 어느 파일에서 멈췄는지 알아야 재시도를 판단할 수 있다.
    const materialSteps = seen.filter((p) => p.stage === 'UPLOADING_MATERIALS')
    expect(materialSteps.map((p) => `${p.materialIndex}/${p.materialCount}:${p.fileName}`))
      .toEqual(expect.arrayContaining(['1/2:a.pptx', '2/2:b.pptx']))
  })

  it('onProgress를 주지 않아도 업로드는 그대로 끝난다', async () => {
    stubApi()

    const result = await httpCurriculumManagementService.uploadRecordedLesson({
      clientRequestId: 'req-2',
      curriculumId: 'cur-1',
      sectionId: 'sec-1',
      title: '녹화 2강',
      description: '',
      videoFile: new File(['x'], 'v.mp4', { type: 'video/mp4' }),
      materials: [],
    })

    expect(result).toMatchObject({ lessonId: 'les-1', processingStatus: 'QUEUED' })
  })
})
