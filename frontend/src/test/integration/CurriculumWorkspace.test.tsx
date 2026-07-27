import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'

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

  // 초안은 DRAFT라 공개 상세(GET /curriculums/{id}, PUBLISHED-only)로 보내면 404로 튕긴다.
  // 생성 후엔 강사 엔드포인트로 읽는 관리 화면으로 바로 이동해야 한다(ADR-0041).
  it('새 커리큘럼을 만들면 관리 화면으로 이동한다', async () => {
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

    // 공개 상세를 거치지 않고 관리 화면으로 직행한다.
    expect(await screen.findByRole('heading', { name: '자료가 있는 새 커리큘럼', level: 1 })).toBeInTheDocument()
    expect(window.location.pathname).toMatch(/^\/instructor\/curriculums\/cur-draft-.*\/manage$/)
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

  it('섹션을 추가하면 자동 저장 전까지 "강의 추가"를 막고, 저장되면 링크로 연다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await screen.findByLabelText('섹션 1 이름')
    await user.click(screen.getByRole('button', { name: '섹션 추가' }))

    // 방금 추가한(아직 임시 id) 섹션의 "강의 추가"는 비활성 버튼이어야 한다 — 존재하지 않는 섹션
    // URL로 못 들어가게(#3). 클릭 가능한 링크가 아니라 disabled 버튼으로 렌더된다.
    const addLessonButtons = screen.getAllByRole('button', { name: '강의 추가' })
    expect(addLessonButtons.some((button) => button.hasAttribute('disabled'))).toBe(true)

    // 디바운스 자동 저장이 새 섹션에 실제 id를 부여하면 "강의 추가"가 링크로 바뀐다.
    await waitFor(() => {
      expect(screen.getByText('자동 저장됨')).toBeInTheDocument()
    }, { timeout: 3000 })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '강의 추가' })).not.toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('새 강의를 저장하면 편집 모드로 이동해 재클릭으로 중복 생성되지 않는다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/new')
    await user.type(await screen.findByLabelText(/강의 제목/), '중복 방지 강의')
    await user.click(screen.getByRole('button', { name: '강의 생성 저장' }))

    // 생성 성공 후엔 고유 URL(편집 모드)로 이동한다 — "새 강의" 폼에 머물며 연타로 매번
    // 새 레슨이 생기던 것을 막는다(#4). 편집 모드 제목으로 전환된 것으로 확인한다.
    expect(await screen.findByRole('heading', { name: '강의 수정', level: 1 })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '강의 수정 저장' })).toBeInTheDocument()
  })

  it('커리큘럼 관리에서는 강의 상세만 제공하고 수정 진입점을 숨긴다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    expect(await screen.findAllByRole('link', { name: '상세' })).not.toHaveLength(0)
    expect(screen.queryByRole('link', { name: '수정' })).not.toBeInTheDocument()
  })

  it('관리 화면에서 실제 수강 신청 목록을 조회하고 승인 상태를 변경한다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await user.click(await screen.findByRole('button', { name: '수강생' }))

    const pendingEmail = await screen.findByText('student02@example.com')
    const pendingRow = pendingEmail.closest('tr')
    expect(pendingRow).not.toBeNull()
    expect(within(pendingRow!).getByText('승인 대기')).toBeInTheDocument()
    await user.click(within(pendingRow!).getByRole('button', { name: '승인' }))

    await waitFor(() => {
      const activeRow = screen.getByText('student02@example.com').closest('tr')
      expect(activeRow).not.toBeNull()
      expect(within(activeRow!).getByText('수강 중')).toBeInTheDocument()
      expect(within(activeRow!).getByRole('button', { name: '제적' })).toBeInTheDocument()
    })
  })

  it('새 강의 폼에서 라이브 강의 일정을 함께 입력한다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/new')
    const scheduleToggle = await screen.findByRole('checkbox', { name: /라이브 강의 일정 설정/ })

    expect(scheduleToggle).not.toBeChecked()
    expect(screen.queryByLabelText(/예정 시작 시각/)).not.toBeInTheDocument()
    await user.click(scheduleToggle)

    expect(screen.getByLabelText(/예정 시작 시각/)).toBeInTheDocument()
    expect(screen.getByLabelText(/예상 진행 시간/)).toHaveValue(90)
    expect(screen.getByLabelText(/입장 가능 창/)).toHaveValue(10)
  })

  it('강의 수정 폼에서 기존 라이브 일정을 불러와 수정한다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security/edit')
    const scheduleToggle = await screen.findByRole('checkbox', { name: /라이브 강의 일정 설정/ })
    const scheduledAt = screen.getByLabelText(/예정 시작 시각/)

    expect(scheduleToggle).toBeChecked()
    expect(scheduledAt).toHaveValue('2026-08-03T19:00')
    await user.clear(scheduledAt)
    await user.type(scheduledAt, '2026-08-04T20:30')
    await user.click(screen.getByRole('button', { name: '강의 수정 저장' }))
    expect(await screen.findByText('강의 정보와 라이브 일정 초안이 저장되었습니다.')).toBeInTheDocument()
  })

  it.each([
    ['다시보기 가능', 'les-orientation'],
    ['다시보기 준비 중', 'les-request-flow'],
  ])('%s 강의 수정 폼에서는 완료된 라이브 일정을 변경할 수 없다', async (_, lessonId) => {
    await renderAsInstructor(`/instructor/curriculums/cur-spring-live/sections/sec-foundation/lessons/${lessonId}/edit`)

    expect(await screen.findByRole('heading', { name: '강의 수정' })).toBeInTheDocument()
    expect(screen.getByLabelText(/강의 제목/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '라이브 강의 일정' })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: /라이브 강의 일정 설정/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/예정 시작 시각/)).not.toBeInTheDocument()
  })

  it('강사 강의 상세에 라이브 일정과 준비 상태를 통합한다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security')
    const editLink = await screen.findByRole('link', { name: '강의 수정' })

    expect(editLink).toHaveClass('button--primary')
    expect(screen.getByRole('heading', { name: '강의 준비 상태' })).toBeInTheDocument()
    expect(screen.getByText('자료 작업')).toBeInTheDocument()
    expect(screen.getByText('완료')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '라이브 일정' })).toBeInTheDocument()
    expect(screen.getByText('오후 7:00')).toBeInTheDocument()
    expect(screen.getByText('오후 6:50부터')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '사전 점검' })).toHaveAttribute(
      'href',
      '/instructor/live-sessions/ses-security-live/preflight',
    )
    expect(screen.queryByRole('link', { name: '강의 상세' })).not.toBeInTheDocument()
  })

  it('라이브 일정이 없는 강사 강의 상세는 강의 수정에서 일정을 추가하도록 안내한다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/cur-spring-live-lesson-6')
    expect(await screen.findByText('연결된 라이브 일정이 없습니다. 강의 수정에서 라이브 강의 일정을 추가해 주세요.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '강의 수정에서 일정 추가' })).toHaveAttribute(
      'href',
      '/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/cur-spring-live-lesson-6/edit',
    )
  })

  it('강사 사전 점검에서는 별도 강의 상세 버튼을 표시하지 않는다', async () => {
    await renderAsInstructor('/instructor/live-sessions/ses-security-live/preflight')
    expect(await screen.findByRole('heading', { name: '라이브 시작 전 최종 점검' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '강의 상세' })).not.toBeInTheDocument()
    expect(screen.getByRole('complementary', { name: '커리큘럼 강의 목록' })).toBeInTheDocument()
  })

  it('강의를 드래그해 같은 섹션 안에서 순서를 변경한다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    const lessonList = await screen.findByRole('list', { name: '서비스의 뼈대 세우기 강의 목록' })
    const requestFlow = within(lessonList).getByRole('listitem', { name: 'HTTP 요청 흐름 해부하기 강의' })
    const orientation = within(lessonList).getByRole('listitem', { name: '오리엔테이션과 개발 환경 강의' })
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: () => undefined }

    fireEvent.dragStart(requestFlow, { dataTransfer })
    fireEvent.dragOver(orientation, { dataTransfer, clientY: 0 })
    fireEvent.drop(orientation, { dataTransfer })

    expect(within(lessonList).getAllByRole('listitem').map((item) => item.getAttribute('aria-label'))).toEqual([
      'HTTP 요청 흐름 해부하기 강의',
      '오리엔테이션과 개발 환경 강의',
      '서비스 계층과 트랜잭션 강의',
    ])
  })

  it('강의를 다른 섹션으로 드래그하면 섹션과 상세 경로를 함께 변경한다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    const foundationList = await screen.findByRole('list', { name: '서비스의 뼈대 세우기 강의 목록' })
    const securityList = screen.getByRole('list', { name: '인증과 인가 강의 목록' })
    const sessionLesson = within(securityList).getByRole('listitem', { name: 'Redis 세션과 CSRF 강의' })
    const orientation = within(foundationList).getByRole('listitem', { name: '오리엔테이션과 개발 환경 강의' })
    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: () => undefined }

    fireEvent.dragStart(sessionLesson, { dataTransfer })
    fireEvent.dragOver(orientation, { dataTransfer, clientY: 0 })
    fireEvent.drop(orientation, { dataTransfer })

    const movedLesson = within(foundationList).getByRole('listitem', { name: 'Redis 세션과 CSRF 강의' })
    expect(within(securityList).queryByRole('listitem', { name: 'Redis 세션과 CSRF 강의' })).not.toBeInTheDocument()
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

  // 커리큘럼-레벨 자료 편집은 로컬 스테이징이다 — 연결 API가 없어 서버에 반영하지 않는다(ADR-0030).
  // 구조/정보는 자동 저장되지만 자료만 바꾼 것으로는 저장이 돌지 않으므로, 여기선 로컬 표시만 확인한다.
  it('관리 화면에서 커리큘럼 자료를 추가하면 목록에 표시된다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await user.click(await screen.findByRole('button', { name: '기본 정보' }))
    const material = new File(['presentation'], 'instructor-common-guide.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })

    await user.upload(screen.getByLabelText('커리큘럼 강의 자료 등록'), material)
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
    for (const detailLink of await within(operatingPanel!).findAllByRole('link', { name: '커리큘럼 상세' })) {
      expect(detailLink).toHaveAttribute('href', expect.stringMatching(/^\/curriculums\/.+/))
    }
    expect(within(operatingPanel!).queryByRole('link', { name: '관리하기' })).not.toBeInTheDocument()
  })

  it('강사 프로필을 수정하면서 운영 커리큘럼 버튼은 표시하지 않는다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/profile')
    expect(await screen.findByRole('heading', { name: '강사 공개 프로필' })).toBeInTheDocument()
    const saveButton = await screen.findByRole('button', { name: '공개 프로필 저장' })
    const bio = screen.getByLabelText('강사 소개')
    await user.clear(bio)
    await user.type(bio, '테스트로 검증한 강의를 제공합니다.')
    await user.click(saveButton)

    expect(await screen.findByText('강사 공개 프로필이 저장되었습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '운영 커리큘럼' })).not.toBeInTheDocument()
  })

  it('프로필 수정 모달에서 이미지와 닉네임을 함께 변경한다', async () => {
    const user = userEvent.setup()
    await renderAsStudent('/student/profile')
    await user.click(await screen.findByRole('button', { name: '프로필 수정' }))

    const dialog = screen.getByRole('dialog', { name: '프로필 수정' })
    const displayName = within(dialog).getByDisplayValue('김학생')
    await user.clear(displayName)
    await user.type(displayName, '김라이브')

    const image = new File(['profile-image'], 'profile.png', { type: 'image/png' })
    await user.upload(within(dialog).getByLabelText('프로필 이미지 선택'), image)
    await user.click(within(dialog).getByRole('button', { name: '변경사항 저장' }))

    expect(await screen.findByText('기본 프로필이 변경되었습니다.')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: '프로필 수정' })).not.toBeInTheDocument()
    expect(screen.getByRole('img', { name: '김라이브 프로필 이미지' }).querySelector('img')).not.toBeNull()
  })

  it('목 프로필 서비스로 비밀번호를 변경하고 회원 탈퇴한다', async () => {
    const user = userEvent.setup()
    await renderAsStudent('/student/profile')

    await user.type(await screen.findByLabelText('현재 비밀번호'), 'current-password')
    await user.type(screen.getByLabelText('새 비밀번호'), 'new-password-123')
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }))
    expect(await screen.findByText('비밀번호가 변경되었습니다.')).toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: '계정 탈퇴에 동의합니다.' }))
    await user.click(screen.getByRole('button', { name: '회원 탈퇴' }))
    await waitFor(() => expect(window.location.pathname).toBe('/login'))
    expect(await screen.findByRole('link', { name: '로그인' })).toBeInTheDocument()
  })

  it('학생 내 커리큘럼에서 승인 대기 목록을 학습 진행 정보 없이 표시한다', async () => {
    await renderAsStudent('/student/curriculums')
    const heading = await screen.findByRole('heading', { name: '승인 대기 중인 커리큘럼' })
    const section = heading.closest('section')

    expect(section).not.toBeNull()
    const pendingSection = within(section!)
    expect(await pendingSection.findByRole('heading', { name: '성능을 바꾸는 SQL 튜닝' })).toBeInTheDocument()
    expect(pendingSection.getByText('승인 대기')).toBeInTheDocument()
    expect(pendingSection.queryByRole('link', { name: '학습 계속하기' })).not.toBeInTheDocument()
    expect(pendingSection.queryByText(/강의$/)).not.toBeInTheDocument()
    expect(pendingSection.getByRole('link', { name: '커리큘럼 상세' })).toBeInTheDocument()
    expect(pendingSection.getByRole('button', { name: '수강 신청 취소' })).toBeInTheDocument()
  })
})
