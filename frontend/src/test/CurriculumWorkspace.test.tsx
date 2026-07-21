import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuth'

async function renderAsInstructor(path: string) {
  await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
  window.history.pushState({}, '', path)
  return render(<App />)
}

async function renderAsStudent(path: string) {
  await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
  window.history.pushState({}, '', path)
  return render(<App />)
}

describe('커리큘럼 작업 화면', () => {
  beforeEach(() => {
    resetMockAuth()
    window.history.replaceState({}, '', '/')
  })

  it('새 커리큘럼의 수강 방식을 강사 승인 방식으로 고정한다', async () => {
    await renderAsInstructor('/instructor/curriculums/new')
    expect(await screen.findByText('강사 승인 후 수강')).toBeInTheDocument()
    expect(screen.queryByText('신청 후 바로 수강')).not.toBeInTheDocument()
    expect(screen.queryByText('초대 전용')).not.toBeInTheDocument()
  })

  it('새 커리큘럼 대표 이미지를 선택해 미리본다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/new')
    await screen.findByRole('heading', { name: '새 커리큘럼 만들기', level: 1 })
    const file = new File(['image'], 'curriculum.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('이미지 등록'), file)
    expect(await screen.findByAltText('대표 이미지 미리보기')).toBeInTheDocument()
  })

  it('관리 화면에서 섹션 이름과 설명을 수정한다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    const title = await screen.findByLabelText('섹션 1 이름')
    const description = screen.getByLabelText('섹션 1 설명')
    await user.clear(title)
    await user.type(title, '새로운 기초 섹션')
    await user.clear(description)
    await user.type(description, '수정된 섹션 설명입니다.')
    expect(title).toHaveValue('새로운 기초 섹션')
    expect(description).toHaveValue('수정된 섹션 설명입니다.')
  })

  it('관리 화면 기본 정보에서 대표 이미지를 변경할 수 있다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await screen.findByRole('heading', { name: '라이브로 완성하는 Spring Boot', level: 1 })
    await user.click(screen.getByRole('button', { name: '기본 정보' }))
    expect(await screen.findByAltText('대표 이미지 미리보기')).toBeInTheDocument()
    expect(screen.getByLabelText('이미지 변경')).toBeInTheDocument()
  })

  it('내 커리큘럼 카드에서 제목 첫 글자 대신 대표 이미지를 표시한다', async () => {
    await renderAsInstructor('/instructor/curriculums')
    expect(await screen.findByAltText('라이브로 완성하는 Spring Boot 대표 이미지')).toBeInTheDocument()
    expect(screen.getByAltText('확장 가능한 서비스 아키텍처 대표 이미지')).toBeInTheDocument()
  })

  it('학생 내 커리큘럼에서 승인 대기 목록을 학습 진행 정보 없이 표시한다', async () => {
    await renderAsStudent('/student/curriculums')
    const heading = await screen.findByRole('heading', { name: '승인 대기 중인 커리큘럼' })
    const section = heading.closest('section')

    expect(section).not.toBeNull()
    const pendingSection = within(section!)
    expect(pendingSection.getByRole('heading', { name: '성능을 바꾸는 SQL 튜닝' })).toBeInTheDocument()
    expect(pendingSection.getByText('승인 대기')).toBeInTheDocument()
    expect(pendingSection.queryByRole('link', { name: '학습 계속하기' })).not.toBeInTheDocument()
    expect(pendingSection.queryByText(/레슨$/)).not.toBeInTheDocument()
    expect(pendingSection.getByRole('link', { name: '상세' })).toBeInTheDocument()
  })
})
