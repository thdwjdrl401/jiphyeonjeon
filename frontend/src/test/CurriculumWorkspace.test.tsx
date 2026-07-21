import { fireEvent, render, screen, within } from '@testing-library/react'
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

  it('새 커리큘럼을 만들면 상세로 이동하고 상세에서 관리 화면에 진입한다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/new')
    await user.type(
      await screen.findByPlaceholderText('예: 라이브로 완성하는 Spring Boot'),
      '자료가 있는 새 커리큘럼',
    )
    const material = new File(['presentation'], 'curriculum-guide.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })

    await user.upload(screen.getByLabelText('커리큘럼 강의 자료 등록'), material)
    expect(screen.getByText('curriculum-guide.pptx')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '초안 만들기' }))

    expect(await screen.findByRole('heading', { name: '자료가 있는 새 커리큘럼', level: 1 })).toBeInTheDocument()
    expect(window.location.pathname).toMatch(/^\/curriculums\/cur-draft-/)
    expect(screen.getByText('curriculum-guide.pptx')).toBeInTheDocument()
    await user.click(screen.getByRole('link', { name: '관리하기' }))
    await user.click(await screen.findByRole('button', { name: '기본 정보' }))

    expect(await screen.findByText('curriculum-guide.pptx')).toBeInTheDocument()
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

  it('레슨을 드래그해 같은 섹션 안에서 순서를 변경한다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    const lessonList = await screen.findByRole('list', { name: '서비스의 뼈대 세우기 레슨 목록' })
    const requestFlow = within(lessonList).getByRole('listitem', { name: 'HTTP 요청 흐름 해부하기 레슨' })
    const orientation = within(lessonList).getByRole('listitem', { name: '오리엔테이션과 개발 환경 레슨' })
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: () => undefined }

    fireEvent.dragStart(requestFlow, { dataTransfer })
    fireEvent.dragOver(orientation, { dataTransfer, clientY: 0 })
    fireEvent.drop(orientation, { dataTransfer })

    expect(within(lessonList).getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'HTTP 요청 흐름 해부하기 레슨',
      '오리엔테이션과 개발 환경 레슨',
      '서비스 계층과 트랜잭션 레슨',
    ])
  })

  it('레슨을 다른 섹션으로 드래그하면 섹션과 상세 경로를 함께 변경한다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    const foundationList = await screen.findByRole('list', { name: '서비스의 뼈대 세우기 레슨 목록' })
    const securityList = screen.getByRole('list', { name: '인증과 인가 레슨 목록' })
    const sessionLesson = within(securityList).getByRole('listitem', { name: 'Redis 세션과 CSRF 레슨' })
    const orientation = within(foundationList).getByRole('listitem', { name: '오리엔테이션과 개발 환경 레슨' })
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: () => undefined }

    fireEvent.dragStart(sessionLesson, { dataTransfer })
    fireEvent.dragOver(orientation, { dataTransfer, clientY: 0 })
    fireEvent.drop(orientation, { dataTransfer })

    const movedLesson = within(foundationList).getByRole('listitem', { name: 'Redis 세션과 CSRF 레슨' })
    expect(within(securityList).queryByRole('listitem', { name: 'Redis 세션과 CSRF 레슨' })).not.toBeInTheDocument()
    expect(within(movedLesson).getByRole('link', { name: '상세' })).toHaveAttribute(
      'href',
      '/instructor/curriculums/cur-spring-live/sections/sec-foundation/lessons/les-session',
    )
  })

  it('관리 화면 기본 정보에서 대표 이미지를 변경할 수 있다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await screen.findByRole('heading', { name: '라이브로 완성하는 Spring Boot', level: 1 })
    await user.click(screen.getByRole('button', { name: '기본 정보' }))
    expect(await screen.findByAltText('대표 이미지 미리보기')).toBeInTheDocument()
    expect(screen.getByLabelText('이미지 변경')).toBeInTheDocument()
  })

  it('관리 화면 최하단에서 커리큘럼 자료를 수정하고 상세에 반영한다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await user.click(await screen.findByRole('button', { name: '기본 정보' }))
    const material = new File(['presentation'], 'instructor-common-guide.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })

    await user.upload(screen.getByLabelText('커리큘럼 강의 자료 등록'), material)
    expect(screen.getByText('instructor-common-guide.pptx')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '변경 저장' }))
    await user.click(screen.getByRole('link', { name: '커리큘럼 상세' }))

    expect(await screen.findByRole('heading', { name: '커리큘럼 강의 자료' })).toBeInTheDocument()
    expect(screen.getByText('instructor-common-guide.pptx')).toBeInTheDocument()
  })

  it('내 커리큘럼 카드에서 제목 첫 글자 대신 대표 이미지를 표시한다', async () => {
    await renderAsInstructor('/instructor/curriculums')
    expect(await screen.findByAltText('라이브로 완성하는 Spring Boot 대표 이미지')).toBeInTheDocument()
    expect(screen.getByAltText('확장 가능한 서비스 아키텍처 대표 이미지')).toBeInTheDocument()
  })

  it('강사 내 커리큘럼의 생성·상세 동선과 사이드바를 단순화한다', async () => {
    await renderAsInstructor('/instructor/curriculums')
    const operatingHeading = await screen.findByRole('heading', { name: '운영 중인 커리큘럼' })
    const operatingPanel = operatingHeading.closest('section')
    const sidebar = screen.getByRole('complementary', { name: '작업 메뉴' })

    expect(operatingPanel).not.toBeNull()
    expect(within(sidebar).queryByRole('link', { name: '커리큘럼 만들기' })).not.toBeInTheDocument()
    expect(within(operatingPanel!).getByRole('link', { name: '새 커리큘럼' })).toHaveAttribute(
      'href',
      '/instructor/curriculums/new',
    )
    for (const detailLink of within(operatingPanel!).getAllByRole('link', { name: '커리큘럼 상세' })) {
      expect(detailLink).toHaveAttribute('href', expect.stringMatching(/^\/curriculums\/.+/))
    }
    expect(within(operatingPanel!).queryByRole('link', { name: '관리하기' })).not.toBeInTheDocument()
  })

  it('강사 프로필에서 운영 커리큘럼 버튼을 표시하지 않는다', async () => {
    await renderAsInstructor('/instructor/profile')
    expect(await screen.findByRole('heading', { name: '강사 공개 프로필' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '운영 커리큘럼' })).not.toBeInTheDocument()
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
    expect(pendingSection.getByRole('link', { name: '커리큘럼 상세' })).toBeInTheDocument()
    expect(pendingSection.getByRole('button', { name: '수강 신청 취소' })).toBeInTheDocument()
  })
})
