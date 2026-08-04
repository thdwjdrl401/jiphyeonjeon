import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import {
  mockCurriculumManagementService,
  resetMockCurriculumManagement,
} from '@/features/curriculum/mockCurriculumManagementService'
import { resetMockRecordedLessons } from '@/features/recorded-lesson/mockRecordedLessonService'

async function createRecordedLesson() {
  const result = await mockCurriculumManagementService.uploadRecordedLesson({
    clientRequestId: `recorded-edit-${Date.now()}`,
    curriculumId: 'cur-spring-live',
    sectionId: 'sec-foundation',
    title: '수정 전 녹화강의',
    description: '수정 전 설명',
    videoFile: new File(['video'], 'recorded.mp4', { type: 'video/mp4' }),
    materials: [],
  })
  return {
    ...result,
    detailPath: `/instructor/curriculums/cur-spring-live/sections/sec-foundation/recorded-lessons/${result.lessonId}`,
    editPath: `/instructor/curriculums/cur-spring-live/sections/sec-foundation/recorded-lessons/${result.lessonId}/edit`,
    legacyEditPath: `/instructor/curriculums/cur-spring-live/sections/sec-foundation/lessons/${result.lessonId}/edit`,
  }
}

async function renderAsInstructor(path: string) {
  await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('녹화강의 수정 화면', () => {
  beforeEach(() => {
    resetMockAuth()
    resetMockCurriculumManagement()
    resetMockRecordedLessons()
    window.history.replaceState({}, '', '/')
  })

  it('관리 목록의 녹화강의 수정 버튼을 전용 수정 경로로 연결한다', async () => {
    const recorded = await createRecordedLesson()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')

    const structurePanel = (await screen.findByRole('heading', { name: '섹션과 강의' })).closest('section')!
    const row = within(structurePanel).getByRole('listitem', { name: '수정 전 녹화강의 강의' })
    expect(within(row).getByRole('link', { name: '수정' })).toHaveAttribute('href', recorded.editPath)
  })

  it('전용 수정 화면에는 녹화강의 정보만 표시하고 라이브 일정은 표시하지 않는다', async () => {
    const recorded = await createRecordedLesson()
    await renderAsInstructor(recorded.editPath)

    expect(await screen.findByRole('heading', { name: '녹화강의 수정', level: 1 })).toBeInTheDocument()
    expect(screen.getByLabelText(/강의 제목/)).toHaveValue('수정 전 녹화강의')
    expect(screen.getByLabelText('설명')).toHaveValue('수정 전 설명')
    expect(screen.getByRole('heading', { name: '녹화 영상' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '라이브 강의 일정' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/예정 시작 시각/)).not.toBeInTheDocument()
  })

  it('제목·설명과 새 자료를 저장하고 녹화강의 상세로 돌아간다', async () => {
    const user = userEvent.setup()
    const recorded = await createRecordedLesson()
    await renderAsInstructor(recorded.editPath)

    const title = await screen.findByLabelText(/강의 제목/)
    await user.clear(title)
    await user.type(title, '수정 완료 녹화강의')
    const description = screen.getByLabelText('설명')
    await user.clear(description)
    await user.type(description, '수정 완료 설명')
    await user.upload(
      screen.getByLabelText('녹화강의 자료 파일'),
      new File(['pptx'], 'recorded-slides.pptx', {
        type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      }),
    )

    await user.click(screen.getByRole('button', { name: '녹화강의 수정 저장' }))

    await waitFor(() => {
      expect(window.location.pathname).toBe(recorded.detailPath)
      expect(screen.getByRole('heading', { name: '수정 완료 녹화강의', level: 1 })).toBeInTheDocument()
    })
    expect(screen.getByText('수정 완료 설명')).toBeInTheDocument()
    expect(screen.getByText('recorded-slides.pptx')).toBeInTheDocument()
    expect(screen.getByText('녹화강의 정보를 수정했습니다.')).toBeInTheDocument()
  })

  it('기존 라이브 수정 URL로 들어온 녹화강의도 전용 수정 URL로 이동시킨다', async () => {
    const recorded = await createRecordedLesson()
    await renderAsInstructor(recorded.legacyEditPath)

    await waitFor(() => expect(window.location.pathname).toBe(recorded.editPath))
    expect(await screen.findByRole('heading', { name: '녹화강의 수정', level: 1 })).toBeInTheDocument()
  })

  it('녹화강의 상세의 수정 버튼도 전용 수정 경로를 가리킨다', async () => {
    const recorded = await createRecordedLesson()
    await renderAsInstructor(recorded.detailPath)

    expect(await screen.findByRole('link', { name: '녹화강의 수정' })).toHaveAttribute('href', recorded.editPath)
  })
})
