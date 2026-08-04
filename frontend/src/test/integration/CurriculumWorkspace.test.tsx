import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import { buildMockCurriculumOutline, getMockCurriculum, publishMockCurriculum } from '@/features/demo/mockDatabase'

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

  // window.confirm 스텁이 다음 테스트로 새지 않게 한다(clearMocks는 호출기록만 지운다).
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // 탭은 작성 흐름(기본 정보 → 구성 → 게시)대로 보이되, 진입은 초안 작업을 이어 갈 구성 탭이다.
  it('관리 화면 탭은 기본 정보·구성·수강생 순으로 보이고 구성 탭으로 진입한다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-architecture/manage')

    const tablist = await screen.findByRole('tablist')
    const labels = within(tablist).getAllByRole('tab').map((button) => button.textContent)
    expect(labels).toEqual(['기본 정보', '구성', '수강생'])
    expect(within(tablist).getByRole('tab', { name: '구성' })).toHaveClass('is-active')

    // 진입 탭이 구성이므로 섹션 편집과 게시 카드가 함께 보인다.
    expect(screen.getByRole('heading', { name: '섹션과 강의' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '커리큘럼 게시' })).toBeInTheDocument()
  })

  it('게시 카드는 기본 정보 탭이 아니라 구성 탭에만 있다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-architecture/manage')
    await screen.findByRole('heading', { name: '커리큘럼 게시' })

    await user.click(screen.getByRole('tab', { name: '기본 정보' }))

    expect(await screen.findByRole('heading', { name: '대표 이미지' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '커리큘럼 강의 자료' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '커리큘럼 게시' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /함께 게시$/ })).not.toBeInTheDocument()
  })

  // 공개 축은 커리큘럼 하나다(ADR-0005) — 게시 버튼을 누르면 안의 강의가 함께 공개된다.
  it('커리큘럼을 게시하면 안의 강의가 함께 공개된다', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    // cur-architecture는 DRAFT 커리큘럼이고 시드 강의는 7개다(레슨 상태는 언제나 PUBLISHED).
    await renderAsInstructor('/instructor/curriculums/cur-architecture/manage')

    // 게시 카드는 진입 기본 탭인 구성 맨 아래에 있다 — 탭을 옮기지 않아도 보인다.
    const publishNotice = await screen.findByText(/모두 수강생에게 공개됩니다/)
    expect(publishNotice.textContent).toContain('강의 7개')
    expect(screen.getByText('커리큘럼 비공개 · 강의 7개 — 게시해야 수강생에게 보입니다.')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '커리큘럼 게시' }))

    expect(await screen.findByText('커리큘럼 공개 중 · 강의 7개 — 카탈로그에서 검색·수강신청할 수 있습니다.')).toBeInTheDocument()
    expect(screen.getByText('공개 중')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '게시 완료' })).toBeDisabled()
  })

  // 강의를 따로 게시하는 축이 없어졌으므로 '커리큘럼만 게시' 우회로도 없다.
  it('강의를 따로 게시하는 우회로를 두지 않는다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-architecture/manage')

    expect(await screen.findByRole('button', { name: '커리큘럼 게시' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '커리큘럼만 게시' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /함께 게시/ })).not.toBeInTheDocument()
  })

  // 레슨에 초안이 없다는 성질을 mock도 지켜야 한다 — 어긋나면 mock 검증이 정책 문제를 가린다.
  it('강의는 커리큘럼이 초안이어도 게시 상태다', async () => {
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })
    expect(getMockCurriculum('cur-architecture')?.lifecycleStatus).toBe('DRAFT')
    const before = buildMockCurriculumOutline(getMockCurriculum('cur-architecture')!)
    expect(before.flatMap((section) => section.lessons).every((lesson) => lesson.status === 'PUBLISHED')).toBe(true)

    publishMockCurriculum('cur-architecture')

    const after = buildMockCurriculumOutline(getMockCurriculum('cur-architecture')!)
    expect(getMockCurriculum('cur-architecture')?.lifecycleStatus).toBe('PUBLISHED')
    expect(after.flatMap((section) => section.lessons).every((lesson) => lesson.status === 'PUBLISHED')).toBe(true)
  })

  it('이미 전부 공개된 커리큘럼은 게시 동작을 비활성한다', async () => {
    // cur-spring-live는 PUBLISHED 커리큘럼이고 시드 강의도 모두 PUBLISHED다.
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')

    expect(await screen.findByRole('button', { name: '게시 완료' })).toBeDisabled()
    expect(screen.getByText('공개 중')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '커리큘럼만 게시' })).not.toBeInTheDocument()
  })

  // 삭제는 초안에서만(ADR-0001). 게시와 함께 구성 탭 맨 아래 게시 카드에 모아 뒀다.
  it('초안 커리큘럼은 게시 카드 안에서 삭제할 수 있다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-architecture/manage')
    const publishPanel = (await screen.findByRole('heading', { name: '커리큘럼 게시' })).closest('section')!

    expect(within(publishPanel).getByRole('button', { name: '커리큘럼 삭제' })).toBeInTheDocument()
    expect(within(publishPanel).getByRole('button', { name: '커리큘럼 게시' })).toBeInTheDocument()
  })

  it('이미 공개된 커리큘럼에는 삭제 버튼을 두지 않는다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await screen.findByRole('heading', { name: '커리큘럼 게시' })

    expect(screen.queryByRole('button', { name: '커리큘럼 삭제' })).not.toBeInTheDocument()
  })

  it('초안을 삭제하면 내 커리큘럼 목록으로 돌아간다', async () => {
    const user = userEvent.setup()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await renderAsInstructor('/instructor/curriculums/cur-architecture/manage')

    await user.click(await screen.findByRole('button', { name: '커리큘럼 삭제' }))

    await waitFor(() => expect(window.location.pathname).toBe('/instructor/curriculums'))
    expect(getMockCurriculum('cur-architecture')).toBeNull()
  })

  // 수강 방식은 강사 승인 하나뿐이라 고르게 하지 않고 안내만 한다.
  it('새 커리큘럼은 수강 방식을 고르지 않고 강사 승인 방식임을 안내한다', async () => {
    await renderAsInstructor('/instructor/curriculums/new')
    const notice = await screen.findByText(/강사가 승인해야 수강이 시작됩니다/)
    expect(notice).toHaveTextContent('강사 승인 후 수강')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByText('신청 후 바로 수강')).not.toBeInTheDocument()
    expect(screen.queryByText('초대 전용')).not.toBeInTheDocument()
  })

  it('새 커리큘럼 대표 이미지를 선택해 미리본다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/new')
    await screen.findByRole('heading', { name: '새 커리큘럼 만들기', level: 1 })
    const file = new File(['image'], 'curriculum.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('대표 이미지 등록'), file)
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

    const materialDropzone = screen.getByText('PPTX 파일을 드래그하거나 클릭해 선택').closest('label')
    expect(materialDropzone).not.toBeNull()
    fireEvent.drop(materialDropzone!, { dataTransfer: { files: [material] } })
    expect(screen.getByText('curriculum-guide.pptx')).toBeInTheDocument()
    expect(screen.getByText('추가 예정')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '초안 만들기' }))

    // 공개 상세를 거치지 않고 관리 화면으로 직행한다.
    expect(await screen.findByRole('heading', { name: '자료가 있는 새 커리큘럼', level: 1 })).toBeInTheDocument()
    expect(window.location.pathname).toMatch(/^\/instructor\/curriculums\/cur-draft-.*\/manage$/)
    await user.click(await screen.findByRole('tab', { name: '기본 정보' }))
    expect(await screen.findByText('curriculum-guide.pptx')).toBeInTheDocument()
  })

  // 예전엔 입력만 받고 버렸다. 입력한 운영 기간이 실제로 커리큘럼에 남는지 본다.
  it('새 커리큘럼에 입력한 운영 기간이 저장된다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/new')
    await user.type(
      await screen.findByPlaceholderText('예: 라이브로 완성하는 Spring Boot'),
      '기간을 넣은 커리큘럼',
    )
    fireEvent.change(screen.getByLabelText('운영 시작일'), { target: { value: '2026-08-01T10:00' } })
    fireEvent.change(screen.getByLabelText('운영 종료일'), { target: { value: '2026-10-15T22:00' } })
    expect(screen.getByText('약 11주 과정')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '초안 만들기' }))
    await screen.findByRole('heading', { name: '기간을 넣은 커리큘럼', level: 1 })

    const curriculumId = window.location.pathname.split('/')[3]
    const period = getMockCurriculum(curriculumId)?.period
    expect(period?.startsAt).toBe(new Date('2026-08-01T10:00').toISOString())
    expect(period?.endsAt).toBe(new Date('2026-10-15T22:00').toISOString())
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
    await user.click(screen.getByRole('button', { name: /섹션 추가/ }))

    // 방금 추가한(아직 임시 id) 섹션의 "강의 추가"는 비활성 버튼이어야 한다 — 존재하지 않는 섹션
    // URL로 못 들어가게(#3). 클릭 가능한 링크가 아니라 disabled 버튼으로 렌더된다.
    const addLessonButtons = screen.getAllByRole('button', { name: '강의 추가' })
    expect(addLessonButtons.some((button) => button.hasAttribute('disabled'))).toBe(true)

    // 디바운스 자동 저장이 새 섹션에 실제 id를 부여하면 "강의 추가"가 링크로 바뀐다.
    await waitFor(() => {
      expect(screen.getByText('자동 저장됨')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '강의 추가' })).not.toBeInTheDocument()
    })
  })

  it('새 강의를 저장하면 구성 화면으로 돌아가 중복 생성을 막는다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/new')
    await user.type(await screen.findByLabelText(/강의 제목/), '중복 방지 강의')
    await user.type(screen.getByLabelText(/예정 시작 시각/), '2026-08-04T20:30')
    await user.click(screen.getByRole('button', { name: '강의 생성 저장' }))

    // 생성 성공 후엔 구성(섹션·강의 목록) 화면으로 돌아간다 — 폼을 떠나므로 연타로 매번 새
    // 레슨이 생기던 것도 막힌다.
    //
    // URL 변경과 폼 언마운트를 한 waitFor 안에서 함께 기다린다. URL만 기다리고 밖에서 단언하면
    // 라우트 리렌더가 끝나기 전에 검사하게 돼 느린 환경에서 실패한다(CI에서 재현, 로컬은 통과).
    await waitFor(() => {
      expect(window.location.pathname).toMatch(/\/instructor\/curriculums\/cur-spring-live\/manage$/)
      expect(screen.queryByRole('button', { name: '강의 생성 저장' })).not.toBeInTheDocument()
    })
  })

  /**
   * 관리 화면 강의 행은 상세·수정 두 링크만 둔다(ADR-0005).
   * 상태 배지는 표시할 것이 없어서 빼고, 삭제는 목록에서 한 번의 오클릭으로 강의가 사라지던
   * 자리라 수정 화면 안으로 옮겼다.
   */
  it('관리 화면 강의 행에 상세·수정만 두고 상태와 삭제는 두지 않는다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')

    const lessonRow = (await screen.findAllByRole('link', { name: '상세' }))[0].closest('li')!
    expect(within(lessonRow).getByRole('link', { name: '상세' })).toBeInTheDocument()
    expect(within(lessonRow).getByRole('link', { name: '수정' })).toBeInTheDocument()
    expect(within(lessonRow).queryByRole('button', { name: '삭제' })).not.toBeInTheDocument()
    expect(within(lessonRow).queryByText('PUBLISHED')).not.toBeInTheDocument()
  })

  it('관리 화면에서 실제 수강 신청 목록을 조회하고 승인 상태를 변경한다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await user.click(await screen.findByRole('tab', { name: '수강생' }))

    expect(await screen.findByText('Spring 수강생 01')).toBeInTheDocument()
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(8)
    const rosterPagination = screen.getByRole('navigation', { name: '수강생 목록 페이지' })
    expect(within(rosterPagination).getAllByRole('button').map((button) => button.textContent)).toEqual(['1', '2', '3', '4', '5'])
    expect(within(rosterPagination).getByRole('button', { name: '1페이지' })).toHaveAttribute('aria-current', 'page')
    expect(within(rosterPagination).queryByRole('button', { name: /이전|다음/ })).not.toBeInTheDocument()
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

  it('새 강의 폼은 체크박스 없이 제목과 라이브 일정만으로 저장할 수 있다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/new')
    const scheduledAt = await screen.findByLabelText(/예정 시작 시각/)
    const submit = screen.getByRole('button', { name: '강의 생성 저장' })

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/예상 진행 시간/)).toHaveValue(90)
    expect(screen.getByLabelText(/입장 가능 창/)).toHaveValue(10)
    expect(submit).toBeDisabled()

    await user.type(screen.getByLabelText(/강의 제목/), '보안 심화 1강')
    expect(submit).toBeDisabled()   // 일정 미입력 — 여전히 비활성
    await user.type(scheduledAt, '2026-08-04T20:30')
    expect(submit).toBeEnabled()

    await user.click(submit)
    expect(await screen.findByText('강의 정보와 라이브 일정이 저장되었습니다.')).toBeInTheDocument()
  })

  it('새 강의 폼의 자료 영역에 PPTX 파일을 드롭해 추가한다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/new')
    const dropzoneCopy = await screen.findByText('PPTX 파일을 드래그하거나 클릭해 선택')
    const dropzone = dropzoneCopy.closest('label')
    const material = new File(['pptx'], 'security-live.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })

    expect(dropzone).not.toBeNull()
    fireEvent.drop(dropzone!, { dataTransfer: { files: [material] } })

    expect(await screen.findByText('security-live.pptx')).toBeInTheDocument()
    expect(screen.getByText('1개 · 준비 필요')).toBeInTheDocument()
  })

  it('강의 수정 폼에서 기존 라이브 일정을 불러와 수정한다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security/edit')
    const scheduledAt = await screen.findByLabelText(/예정 시작 시각/)
    const breadcrumbs = screen.getByRole('navigation', { name: '강의 경로' })

    expect(scheduledAt).toHaveValue('2026-08-03T19:00')
    expect(within(breadcrumbs).getByRole('link', { name: 'Spring Security 시작하기' })).toHaveAttribute(
      'href',
      '/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security',
    )
    expect(within(breadcrumbs).queryByText('강의 수정')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '강의 수정' }).closest('header')?.querySelector('p')).toBeNull()
    await user.clear(scheduledAt)
    await user.type(scheduledAt, '2026-08-04T20:30')
    await user.click(screen.getByRole('button', { name: '강의 수정 저장' }))
    expect(await screen.findByText('강의 정보와 라이브 일정이 저장되었습니다.')).toBeInTheDocument()
  })

  it.each([
    ['다시보기 가능', 'les-orientation'],
    ['다시보기 준비 중', 'les-request-flow'],
  ])('%s 강의 수정 폼에서는 완료된 라이브 일정을 변경할 수 없다', async (_, lessonId) => {
    await renderAsInstructor(`/instructor/curriculums/cur-spring-live/sections/sec-foundation/lessons/${lessonId}/edit`)

    expect(await screen.findByRole('heading', { name: '강의 수정' })).toBeInTheDocument()
    expect(screen.getByLabelText(/강의 제목/)).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '라이브 강의 일정' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/예정 시작 시각/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '강의 수정 저장' })).toBeEnabled()
  })

  it('강사 강의 상세에 라이브 일정과 준비 상태를 통합한다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security')
    const editLink = await screen.findByRole('link', { name: '강의 수정' })
    const breadcrumbs = screen.getByRole('navigation', { name: '강의 경로' })

    expect(editLink).toHaveClass('button--primary')
    expect(within(breadcrumbs).getByText('Spring Security 시작하기')).toHaveAttribute('aria-current', 'page')
    const lessonInfo = screen.getByRole('heading', { name: '강의 정보' }).closest('section')
    expect(lessonInfo).not.toBeNull()
    expect(within(lessonInfo!).getByText('인증 필터와 세션의 흐름을 실제 요청을 따라가며 이해합니다.')).toBeInTheDocument()
    expect(within(editLink.closest('header')!).queryByText('인증 필터와 세션의 흐름을 실제 요청을 따라가며 이해합니다.')).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '강의 준비 상태' })).not.toBeInTheDocument()
    const readiness = screen.getByRole('list', { name: '강의 준비 상태' })
    expect(within(readiness).getByText('자료 작업')).toBeInTheDocument()
    expect(within(readiness).getByText('완료')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '라이브 일정' })).toBeInTheDocument()
    const reminderTrigger = within(lessonInfo!).getByRole('button', { name: '라이브 시작 알림 설정' })
    expect(reminderTrigger.closest('.workspace-panel__header')).not.toBeNull()
    await userEvent.click(reminderTrigger)
    const reminderDialog = screen.getByRole('dialog', { name: '이 강의 라이브 시작 알림' })
    expect(await within(reminderDialog).findByText(/기본 설정을 따르고 있습니다/)).toBeInTheDocument()
    expect(screen.getByText('오후 7:00')).toBeInTheDocument()
    expect(screen.getByText('오후 6:50부터')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '사전 점검 시작' })).toHaveAttribute(
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
    await user.click(screen.getByRole('tab', { name: '기본 정보' }))
    expect(await screen.findByAltText('대표 이미지 미리보기')).toBeInTheDocument()
    expect(screen.getByLabelText('대표 이미지 등록')).toBeInTheDocument()
  })

  // 커리큘럼-레벨 자료 편집은 로컬 스테이징이다 — 연결 API가 없어 서버에 반영하지 않는다(ADR-0030).
  // 구조/정보는 자동 저장되지만 자료만 바꾼 것으로는 저장이 돌지 않으므로, 여기선 로컬 표시만 확인한다.
  it('관리 화면에서 커리큘럼 자료를 추가하면 목록에 표시된다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await user.click(await screen.findByRole('tab', { name: '기본 정보' }))
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
    // 상세 진입점은 카드 제목 링크다 — 별도 "커리큘럼 상세" 버튼은 없앴다.
    const titleLinks = (await within(operatingPanel!).findAllByRole('heading', { level: 3 }))
      .map((heading) => within(heading).getByRole('link'))
    expect(titleLinks.length).toBeGreaterThan(0)
    for (const titleLink of titleLinks) {
      expect(titleLink).toHaveAttribute('href', expect.stringMatching(/^\/curriculums\/.+/))
    }
    expect(within(operatingPanel!).queryByRole('link', { name: '커리큘럼 상세' })).not.toBeInTheDocument()
    expect(within(operatingPanel!).queryByRole('link', { name: '관리하기' })).not.toBeInTheDocument()
  })

  // 목록은 탐색·진입만 맡는다. 삭제 같은 상태 변경은 관리 화면으로 모았다.
  it('내 커리큘럼 카드에는 관리 버튼만 남기고 삭제 버튼은 두지 않는다', async () => {
    await renderAsInstructor('/instructor/curriculums')
    const operatingHeading = await screen.findByRole('heading', { name: '운영 중인 커리큘럼' })
    const operatingPanel = operatingHeading.closest('section')!

    for (const manageLink of await within(operatingPanel).findAllByRole('link', { name: '관리' })) {
      expect(manageLink).toHaveAttribute('href', expect.stringMatching(/^\/instructor\/curriculums\/.+\/manage$/))
    }
    expect(within(operatingPanel).queryByRole('button', { name: '삭제' })).not.toBeInTheDocument()
  })

  it('카드 제목을 누르면 커리큘럼 상세로, 관리 버튼을 누르면 관리 화면으로 간다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums')
    const operatingHeading = await screen.findByRole('heading', { name: '운영 중인 커리큘럼' })
    const operatingPanel = operatingHeading.closest('section')!

    // 카드가 통째로 링크라도 관리 버튼은 제 목적지로 가야 한다.
    await user.click((await within(operatingPanel).findAllByRole('link', { name: '관리' }))[0])
    await waitFor(() => expect(window.location.pathname).toMatch(/^\/instructor\/curriculums\/.+\/manage$/))
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

  /**
   * 학생은 "프로필 수정" 카드에서 **모달 없이** 이미지와 닉네임을 함께 바꾼다(ADR-0011).
   * 강사의 모달 흐름은 ProfilePage.test.tsx가 본다 — 여기서는 목 서비스까지 실제로 저장되는지 본다.
   */
  it('학생 프로필 수정 카드에서 이미지와 닉네임을 함께 변경한다', async () => {
    const user = userEvent.setup()
    await renderAsStudent('/student/profile')

    const panel = (await screen.findByRole('heading', { name: '프로필 수정' })).closest('section')!
    const displayName = within(panel).getByDisplayValue('김학생')
    await user.clear(displayName)
    await user.type(displayName, '김라이브')

    const image = new File(['profile-image'], 'profile.png', { type: 'image/png' })
    await user.upload(within(panel).getByLabelText('프로필 이미지 선택'), image)
    await user.click(within(panel).getByRole('button', { name: '변경사항 저장' }))

    expect(await screen.findByText('기본 프로필이 변경되었습니다.')).toBeInTheDocument()
    // 상단 프로필 카드의 아바타가 바뀐 이미지·이름으로 갱신된다.
    const identityCard = screen.getByRole('region', { name: '김라이브' })
    expect(within(identityCard).getByRole('img', { name: '김라이브 프로필 이미지' }).querySelector('img')).not.toBeNull()
    // 저장한 뒤에는 바뀐 것이 없으므로 다시 저장할 수 없다.
    expect(within(panel).getByRole('button', { name: '변경사항 저장' })).toBeDisabled()
  })

  it('목 프로필 서비스로 비밀번호를 변경하고 회원 탈퇴한다', async () => {
    const user = userEvent.setup()
    await renderAsStudent('/student/profile')

    await user.type(await screen.findByLabelText('현재 비밀번호'), 'current-password')
    await user.type(screen.getByLabelText('새 비밀번호'), 'new-password-123')
    // 확인 필드까지 맞아야 제출이 열린다.
    await user.type(screen.getByLabelText('새 비밀번호 확인'), 'new-password-123')
    await user.click(screen.getByRole('button', { name: '비밀번호 변경' }))
    expect(await screen.findByText('비밀번호가 변경되었습니다.')).toBeInTheDocument()

    // 탈퇴는 카드의 진입 버튼 → 모달(안내·동의) → "탈퇴하기" 순서다(ADR-0011).
    await user.click(screen.getByRole('button', { name: '회원 탈퇴' }))
    const withdrawDialog = await screen.findByRole('dialog', { name: '회원 탈퇴' })
    await user.click(within(withdrawDialog).getByRole('checkbox', { name: /위 안내 사항을 모두 확인하였으며/ }))
    await user.click(within(withdrawDialog).getByRole('button', { name: '탈퇴하기' }))

    // 탈퇴하면 랜딩페이지다(ADR-0068). 규칙 자체는 guestRedirect.test.tsx가 고정한다.
    await waitFor(() => expect(window.location.pathname).toBe('/'))
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
    expect(pendingSection.getByRole('link', { name: '성능을 바꾸는 SQL 튜닝' })).toHaveAttribute('href', '/curriculums/cur-sql')
    expect(pendingSection.getByRole('button', { name: '수강 신청 취소' })).toBeInTheDocument()
  })
})
