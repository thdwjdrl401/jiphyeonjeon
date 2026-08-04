import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import {
  mockCurriculumManagementService,
  resetMockCurriculumManagement,
} from '@/features/curriculum/mockCurriculumManagementService'
import {
  mockRecordedLessonService,
  resetMockRecordedLessons,
  setMockRecordedCaptionProcessing,
  setMockRecordedProcessing,
} from '@/features/recorded-lesson/mockRecordedLessonService'
import type { RecordedProcessingStatus } from '@/features/recorded-lesson/recordedLessonService.interface'

vi.mock('@/features/media/HlsMediaPlayer', () => ({
  default: ({ sourceUrl, title }: { sourceUrl: string; title: string }) => (
    <div data-testid="mock-hls-player">HLS 미리보기 · {title} · {sourceUrl}</div>
  ),
}))

async function createRecordedLesson(status: RecordedProcessingStatus, failureCode: string | null = null) {
  const result = await mockCurriculumManagementService.uploadRecordedLesson({
    clientRequestId: `request-${status}-${Date.now()}`,
    curriculumId: 'cur-spring-live',
    sectionId: 'sec-foundation',
    title: `상세 테스트 녹화강의 ${status}`,
    description: '업로드한 녹화강의를 상세 화면에서 확인합니다.',
    videoFile: new File(['video'], 'recorded.mp4', { type: 'video/mp4' }),
    materials: [],
  })
  setMockRecordedProcessing(result.lessonId, status, failureCode)
  return {
    ...result,
    path: `/instructor/curriculums/cur-spring-live/sections/sec-foundation/recorded-lessons/${result.lessonId}`,
  }
}

async function renderAsInstructor(path: string) {
  await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('녹화강의 상세 화면', () => {
  beforeEach(() => {
    resetMockAuth()
    resetMockCurriculumManagement()
    resetMockRecordedLessons()
    window.history.replaceState({}, '', '/')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('관리 목록의 녹화강의 상세 링크를 전용 상세 라우트로 연결한다', async () => {
    const recorded = await createRecordedLesson('READY')
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')

    const structurePanel = (await screen.findByRole('heading', { name: '섹션과 강의' })).closest('section')!
    const row = within(structurePanel).getByRole('listitem', { name: '상세 테스트 녹화강의 READY 강의' })
    expect(within(row).getByRole('link', { name: '상세' })).toHaveAttribute('href', recorded.path)
  })

  it.each([
    ['QUEUED', '변환 대기'],
    ['TRANSCODING', 'HLS 변환'],
    ['VERIFYING', '재생 검증'],
  ] as const)('%s 상태의 현재 처리 단계를 표시하고 플레이어는 열지 않는다', async (status, stage) => {
    const recorded = await createRecordedLesson(status)
    const getPlayback = vi.spyOn(mockRecordedLessonService, 'getPlayback')
    await renderAsInstructor(recorded.path)

    expect(await screen.findByRole('heading', { name: `상세 테스트 녹화강의 ${status}`, level: 1 })).toBeInTheDocument()
    expect(await screen.findByText(`HLS ${status}`)).toBeInTheDocument()
    expect((await screen.findByText(stage)).closest('li')).toHaveAttribute('aria-current', 'step')
    expect(getPlayback).not.toHaveBeenCalled()
    expect(screen.queryByTestId('mock-hls-player')).not.toBeInTheDocument()
  })

  it('READY 상태가 관찰되면 recorded playback을 조회하고 공통 HLS 플레이어를 연다', async () => {
    const recorded = await createRecordedLesson('READY')
    await renderAsInstructor(recorded.path)

    expect(await screen.findByTestId('mock-hls-player')).toHaveTextContent(
      `/api/lessons/${recorded.lessonId}/recorded-playback/manifest`,
    )
    expect(screen.getByText('1시간 0분 0초')).toBeInTheDocument()
    expect(screen.getByText('PUBLISHED')).toBeInTheDocument()
  })

  it('FAILED 원인과 코드를 표시하고 재시도 성공 뒤 QUEUED polling 상태로 돌아간다', async () => {
    const user = userEvent.setup()
    const recorded = await createRecordedLesson('FAILED', 'FFMPEG_FAILED')
    await renderAsInstructor(recorded.path)

    expect(await screen.findByText('영상을 HLS로 변환하지 못했습니다.')).toBeInTheDocument()
    expect(screen.getByText('FFMPEG_FAILED')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '다시 처리' }))

    await waitFor(() => {
      expect(screen.getByText('HLS QUEUED')).toBeInTheDocument()
      expect(screen.getByText('변환 대기').closest('li')).toHaveAttribute('aria-current', 'step')
    })
    expect(screen.getByText('영상 처리를 다시 시작했습니다.')).toBeInTheDocument()
  })

  it('HLS가 준비됐어도 자막 실패면 플레이어를 열지 않고 자막만 재시도한다', async () => {
    const user = userEvent.setup()
    const recorded = await createRecordedLesson('READY')
    setMockRecordedCaptionProcessing(recorded.lessonId, 'FAILED', 'STT_PROVIDER_UNAVAILABLE')
    const getPlayback = vi.spyOn(mockRecordedLessonService, 'getPlayback')
    await renderAsInstructor(recorded.path)

    expect(await screen.findByText('자막 생성 서비스에 일시적인 문제가 있습니다.')).toBeInTheDocument()
    expect(screen.queryByTestId('mock-hls-player')).not.toBeInTheDocument()
    expect(getPlayback).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: '자막 다시 처리' }))
    await waitFor(() => {
      expect(screen.getByText('자막 PENDING')).toBeInTheDocument()
      expect(screen.getByText('HLS READY')).toBeInTheDocument()
    })
  })
})
