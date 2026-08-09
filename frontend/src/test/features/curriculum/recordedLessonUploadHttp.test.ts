import axios from 'axios'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { httpCurriculumManagementService } from '@/features/curriculum/httpCurriculumManagementService'
import { httpRecordedLessonService } from '@/features/recorded-lesson/httpRecordedLessonService'
import { apiClient } from '@/shared/api/client'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))
vi.mock('@/shared/api/uploadAsset', () => ({
  uploadAsset: vi.fn(async () => ({ assetId: 'material-asset-1', kind: 'MATERIAL', status: 'UPLOADED' })),
  // 영상 PUT은 putBytes를 거친다(진행률 보고를 붙이면서 axios 직접 호출을 걷어냈다). 이 테스트는
  // 아래에서 axios.request 자체를 감시하므로, 여기서는 실제 구현을 그대로 통과시킨다.
  putBytes: vi.fn(async (ticket: { uploadUrl: string; method: string; headers: Record<string, string> }, file: File) => {
    await axios.request({ url: ticket.uploadUrl, method: ticket.method, headers: ticket.headers, data: file })
  }),
}))

describe('녹화강의 HTTP 업로드 계약', () => {
  afterEach(() => vi.restoreAllMocks())

  it('녹화강의 생성 뒤 PPTX 자료를 연결하고 영상 presigned PUT·완료 접수를 수행한다', async () => {
    const post = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ data: {
        lessonId: 'lesson-1', recordedVideoId: 'recorded-1',
        deliveryType: 'RECORDED', processingStatus: 'AWAITING_UPLOAD',
      } } as never)
      .mockResolvedValueOnce({ data: {
        materialId: 'material-1', assetId: 'material-asset-1', fileName: 'deck.pptx', status: 'ACTIVE',
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
    const material = new File(['pptx-bytes'], 'deck.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })

    await expect(httpCurriculumManagementService.uploadRecordedLesson({
      clientRequestId: 'client-request-1',
      curriculumId: 'curriculum-1',
      sectionId: 'section-1',
      title: '녹화강의',
      description: '설명',
      videoFile: file,
      materials: [material],
    })).resolves.toEqual({
      lessonId: 'lesson-1', recordedVideoId: 'recorded-1', jobId: 'job-1', processingStatus: 'QUEUED',
    })

    expect(post.mock.calls).toEqual([
      ['/instructor/sections/section-1/recorded-lessons', {
        clientRequestId: 'client-request-1', title: '녹화강의', description: '설명',
      }],
      ['/instructor/lessons/lesson-1/materials', { assetId: 'material-asset-1' }],
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

/**
 * 자료는 <b>연결까지 끝났을 때</b> 알려야 한다.
 *
 * <p>업로드는 ①레슨 생성 ②자료 ③영상 PUT 순인데, 5GiB가 오가는 ③이 가장 흔한 실패 지점이다.
 * 그때 재시도가 ②를 처음부터 다시 돌면 같은 PPTX가 두 번 붙고, 그때마다 수강생 전원에게 자료
 * 알림이 다시 나간다(ADR-0073). 레슨은 clientRequestId로 멱등인데 자료는 아니라서 생기는 어긋남이다.
 *
 * <p>화면이 건너뛸 수 있으려면 <b>무엇이 붙었는지</b>를 알아야 하고, 이 신호가 그것이다.
 */
describe('자료 연결 신호', () => {
  afterEach(() => vi.restoreAllMocks())

  const material = (name: string) => new File(['pptx'], name, {
    type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  })

  function stubUntilVideoPut(putFails: boolean) {
    vi.spyOn(apiClient, 'post').mockImplementation((path: string) => {
      if (path.endsWith('/recorded-lessons')) {
        return Promise.resolve({ data: { lessonId: 'lesson-1', recordedVideoId: 'r-1' } } as never)
      }
      if (path.endsWith('/materials')) return Promise.resolve({ data: { materialId: 'm' } } as never)
      if (path.endsWith('/upload-requests')) {
        return Promise.resolve({ data: {
          assetId: 'asset-1', uploadUrl: 'https://storage/upload', method: 'PUT', headers: {},
        } } as never)
      }
      return Promise.resolve({ data: { lessonId: 'lesson-1', jobId: 'job-1', status: 'QUEUED' } } as never)
    })
    vi.spyOn(axios, 'request').mockImplementation(() => (putFails
      ? Promise.reject(new Error('네트워크가 끊겼습니다'))
      : Promise.resolve({ data: undefined } as never)))
  }

  const request = (materials: File[], onMaterialLinked?: (file: File) => void) => ({
    clientRequestId: 'client-request-1',
    curriculumId: 'curriculum-1',
    sectionId: 'section-1',
    title: '녹화강의',
    description: '',
    videoFile: new File(['mp4'], 'lecture.mp4', { type: 'video/mp4' }),
    materials,
    onMaterialLinked,
  })

  it('연결된 자료를 하나씩 알린다', async () => {
    stubUntilVideoPut(false)
    const linked: string[] = []
    const files = [material('a.pptx'), material('b.pptx')]

    await httpCurriculumManagementService.uploadRecordedLesson(
      request(files, (file) => linked.push(file.name)),
    )

    expect(linked).toEqual(['a.pptx', 'b.pptx'])
  })

  /** 영상에서 끊겨도 그 전에 붙은 자료는 붙은 것이다 — 다음 시도가 건너뛸 수 있어야 한다. */
  it('영상 업로드가 끊겨도 이미 붙은 자료는 알린 뒤 실패한다', async () => {
    stubUntilVideoPut(true)
    const linked: string[] = []

    await expect(httpCurriculumManagementService.uploadRecordedLesson(
      request([material('a.pptx')], (file) => linked.push(file.name)),
    )).rejects.toThrow()

    expect(linked).toEqual(['a.pptx'])
  })
})

/**
 * 업로드가 끊긴 강의에 원본을 <b>다시 올리는</b> 경로.
 *
 * <p>예전에는 이 길이 화면에 없었다 — 강의는 만들어졌는데 영상만 없는 상태에서, 상세는 안내만 하고
 * 수정 화면은 "원본 교체를 지원하지 않습니다"라고 답했다. 5GiB 업로드가 끊기는 건 예외가 아니라
 * 일상인데, 그때 남는 선택지가 <b>지우고 처음부터</b>뿐이었다.
 *
 * <p>서버는 처음부터 열려 있었다: `issueUpload`가 AWAITING_UPLOAD에서 이전 에셋을 버리고 새로
 * 발급한다. 그래서 티켓 → PUT → 접수, 업로드 화면의 ③④와 같은 경로를 그대로 탄다.
 */
describe('녹화강의 영상 재업로드', () => {
  afterEach(() => vi.restoreAllMocks())

  it('티켓을 받아 스토리지에 직접 올리고 접수까지 한다', async () => {
    const post = vi.spyOn(apiClient, 'post')
      .mockResolvedValueOnce({ data: {
        assetId: 'asset-2', uploadUrl: 'https://storage/re-upload', method: 'PUT',
        headers: { 'Content-Type': 'video/mp4' },
      } } as never)
      .mockResolvedValueOnce({ data: {
        lessonId: 'lesson-1', recordedVideoId: 'r-1', jobId: 'job-2', status: 'QUEUED',
        captionStatus: 'PENDING', recordedPublicationStatus: 'DRAFT',
      } } as never)
    const storagePut = vi.spyOn(axios, 'request').mockResolvedValue({ data: undefined } as never)
    const file = new File(['mp4'], 'again.mp4', { type: 'video/mp4' })

    const processing = await httpRecordedLessonService.uploadRecordedVideo('lesson-1', file)

    expect(post.mock.calls.map(([path]) => path)).toEqual([
      '/instructor/recorded-lessons/lesson-1/video/upload-requests',
      '/instructor/recorded-lessons/lesson-1/video/complete',
    ])
    // 새 티켓의 assetId로 접수해야 한다 — 예전 에셋으로 접수하면 서버가 SOURCE_STALE로 막는다.
    expect(post.mock.calls[1][1]).toEqual({ assetId: 'asset-2' })
    expect(storagePut).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://storage/re-upload', method: 'PUT', data: file,
    }))
    expect(processing.status).toBe('QUEUED')
  })
})
