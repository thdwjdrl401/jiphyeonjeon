import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import { mockCurriculumManagementService, resetMockCurriculumManagement } from '@/features/curriculum/mockCurriculumManagementService'
import { buildMockCurriculumOutline, getMockCurriculum, publishMockCurriculum } from '@/features/demo/mockDatabase'
import * as materialDownloadService from '@/features/material/materialDownloadService'
import { todayLocalStart } from '@/shared/lib/localDateTime'

const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

/**
 * 오늘에서 days만큼 옮긴 datetime-local 문자열. 고정 날짜를 박으면 그날이 지나는 순간
 * "과거 일정" 검증에 걸려 테스트가 썩는다(실제로 2026-08-04로 박아 둔 값이 그렇게 됐다).
 */
function localDateTimeInDays(days: number, time = '20:30'): string {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${time}`
}

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
    resetMockCurriculumManagement()
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

  /**
   * 요약 툴바의 수강생 수. 서버가 이 값을 주지 않으면 화면이 조용히 `--`로 떨어지므로
   * (실제로 그 상태였다 — 응답에 필드 자체가 없었다) 실제 숫자가 그려지는지 못박는다.
   */
  it('요약 툴바가 수강생 수를 보여 준다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-architecture/manage')

    const summary = await screen.findByRole('group', { name: '커리큘럼 관리 요약' })
    const enrollees = within(summary).getByText('수강생').parentElement!
    expect(enrollees).toHaveTextContent(String(getMockCurriculum('cur-architecture')!.enrolleeCount))
    expect(enrollees).not.toHaveTextContent('--')
  })

  /**
   * 자동 저장 실패는 <b>토스트로</b> 알린다.
   *
   * <p>예전에는 요약 툴바 위에 inline-notice를 끼워 넣었다. 자동 저장은 편집 중(디바운스 1초)에
   * 도는 것이라, 그 한 줄이 들어올 때마다 <b>글을 쓰는 손 밑에서</b> 화면 전체가 59px 내려갔다.
   * 실제 브라우저에서 잰 값이다.
   */
  it('자동 저장이 실패하면 토스트로 알리고 요약 툴바를 밀어내지 않는다', async () => {
    vi.spyOn(mockCurriculumManagementService, 'saveCurriculumManagement')
      .mockRejectedValue(new Error('boom'))
    await renderAsInstructor('/instructor/curriculums/cur-architecture/manage')

    const summary = await screen.findByRole('group', { name: '커리큘럼 관리 요약' })
    const before = summary.compareDocumentPosition(document.body)

    const [sectionTitle] = screen.getAllByLabelText(/^섹션 \d+ 이름$/)
    fireEvent.change(sectionTitle, { target: { value: '이름을 바꾼 섹션' } })

    // 알림 영역(toast-viewport) 안에서 나와야 한다 — 본문 흐름에 끼면 아래가 통째로 밀린다.
    const viewport = await screen.findByRole('region', { name: '알림' })
    await waitFor(() => expect(within(viewport).getByText('변경 내용을 자동 저장하지 못했습니다.')).toBeInTheDocument())

    expect(summary.compareDocumentPosition(document.body)).toBe(before)
    // 헤더의 상태 칩은 그대로 남아 지속 신호 역할을 한다.
    expect(screen.getByText('저장 실패')).toBeInTheDocument()
  })

  /** 같은 실패가 이어져도 토스트를 쌓지 않는다 — 서버가 계속 죽어 있으면 편집할 때마다 한 장씩 는다. */
  it('같은 저장 실패가 반복돼도 토스트를 겹쳐 쌓지 않는다', async () => {
    vi.spyOn(mockCurriculumManagementService, 'saveCurriculumManagement')
      .mockRejectedValue(new Error('boom'))
    await renderAsInstructor('/instructor/curriculums/cur-architecture/manage')
    await screen.findByRole('group', { name: '커리큘럼 관리 요약' })

    const [sectionTitle] = screen.getAllByLabelText(/^섹션 \d+ 이름$/)
    fireEvent.change(sectionTitle, { target: { value: '한 번' } })
    const viewport = await screen.findByRole('region', { name: '알림' })
    await waitFor(() => expect(within(viewport).getByText('변경 내용을 자동 저장하지 못했습니다.')).toBeInTheDocument())

    fireEvent.change(sectionTitle, { target: { value: '두 번' } })
    await waitFor(() => expect(
      within(viewport).getAllByText('변경 내용을 자동 저장하지 못했습니다.'),
    ).toHaveLength(1))
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
      await screen.findByPlaceholderText(/^예: 라이브로 완성하는 Spring Boot/),
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
      await screen.findByPlaceholderText(/^예: 라이브로 완성하는 Spring Boot/),
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

  // 브라우저 기본 검증이 "유효한 값을 입력하세요" 풍선으로 먼저 가로채면 무엇이 틀렸는지 알 수 없다.
  // 키보드로 과거 종료일을 직접 넣어도 우리 문구가 나와야 한다.
  it('운영 종료일을 오늘보다 이전으로 넣으면 토스트로 이유를 알리고 만들지 않는다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/new')
    await user.type(
      await screen.findByPlaceholderText(/^예: 라이브로 완성하는 Spring Boot/),
      '지난 날짜로 끝나는 커리큘럼',
    )

    fireEvent.change(screen.getByLabelText('운영 종료일'), { target: { value: localDateTimeInDays(-1, '09:00') } })
    const submit = screen.getByRole('button', { name: '초안 만들기' })

    // 잘못된 값을 서버로 보낼 수 없게 즉시 잠그고, 날짜를 고치면 다시 저장할 수 있어야 한다.
    expect(submit).toBeDisabled()

    // 폼 아래 고정 문구가 아니라 입력 시점에 토스트로 나가야 한다 — 알림 영역 안에서 찾는다.
    const toastRegion = await screen.findByRole('region', { name: '알림' })
    expect(await within(toastRegion).findByText('운영 종료일은 오늘보다 이전일 수 없습니다.')).toBeInTheDocument()
    // 초안이 만들어지지 않았으니 생성 폼에 그대로 머문다.
    expect(window.location.pathname).toBe('/instructor/curriculums/new')

    fireEvent.change(screen.getByLabelText('운영 종료일'), { target: { value: localDateTimeInDays(1, '09:00') } })
    expect(submit).toBeEnabled()
  })

  it('React 상태보다 DOM 날짜 입력이 먼저 바뀌어도 과거 운영 종료일로 만들지 않는다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/new')
    await user.type(
      await screen.findByPlaceholderText(/^예: 라이브로 완성하는 Spring Boot/),
      'DOM 검증 커리큘럼',
    )

    // 일부 브라우저의 datetime-local 키보드 입력처럼 DOM 값이 React change보다 먼저 완성된 상황을 재현한다.
    const endsAtInput = screen.getByLabelText('운영 종료일') as HTMLInputElement
    endsAtInput.value = localDateTimeInDays(-1, '09:00')
    await user.click(screen.getByRole('button', { name: '초안 만들기' }))

    const toastRegion = await screen.findByRole('region', { name: '알림' })
    expect(await within(toastRegion).findByText('운영 종료일은 오늘보다 이전일 수 없습니다.')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/instructor/curriculums/new')
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

  it('섹션을 추가하면 자동 저장 전까지 두 강의 추가 방식을 막고, 저장되면 링크로 연다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await screen.findByLabelText('섹션 1 이름')
    await user.click(screen.getByRole('button', { name: /섹션 추가/ }))

    const newDescription = screen.getAllByLabelText(/섹션 \d+ 설명/).at(-1)
    expect(newDescription).toHaveValue('')
    expect(newDescription).toHaveAttribute('placeholder', '설명을 입력해 주세요.')

    // 방금 추가한(아직 임시 id) 섹션의 두 버튼은 모두 비활성이어야 한다 — 존재하지 않는 섹션
    // URL로 못 들어가게 한다. 클릭 가능한 링크가 아니라 disabled 버튼으로 렌더된다.
    expect(screen.getAllByRole('button', { name: '녹화강의 업로드' }).some((button) => button.hasAttribute('disabled'))).toBe(true)
    expect(screen.getAllByRole('button', { name: '라이브 강의 추가' }).some((button) => button.hasAttribute('disabled'))).toBe(true)

    // 디바운스 자동 저장이 새 섹션에 실제 id를 부여하면 "강의 추가"가 링크로 바뀐다.
    await waitFor(() => {
      expect(screen.getByText('자동 저장됨')).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: '녹화강의 업로드' })).not.toBeInTheDocument()
      expect(screen.queryByRole('button', { name: '라이브 강의 추가' })).not.toBeInTheDocument()
    })
  })

  it('섹션 아래에 녹화강의 업로드와 라이브 강의 추가를 순서대로 제공한다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')

    const section = (await screen.findByLabelText('섹션 1 이름')).closest('article')!
    const recorded = within(section).getByRole('link', { name: '녹화강의 업로드' })
    const live = within(section).getByRole('link', { name: '라이브 강의 추가' })

    expect(recorded).toHaveAttribute(
      'href',
      '/instructor/curriculums/cur-spring-live/sections/sec-foundation/recorded-lessons/new',
    )
    expect(live).toHaveAttribute(
      'href',
      '/instructor/curriculums/cur-spring-live/sections/sec-foundation/lessons/new',
    )
    expect(recorded.compareDocumentPosition(live) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('녹화강의 업로드 화면에서 MP4를 검증하고 업로드 흐름을 완료한다', async () => {
    // 실제 파일 선택 이벤트를 유지하되, 브라우저가 accept와 맞지 않는 파일도 넘겨준 상황까지
    // 검증할 수 있도록 테스트에서만 accept 필터를 해제한다.
    const user = userEvent.setup({ applyAccept: false })
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await user.click((await screen.findAllByRole('link', { name: '녹화강의 업로드' }))[0])

    expect(await screen.findByRole('heading', { name: '녹화강의 업로드', level: 1 })).toBeInTheDocument()
    expect(window.location.pathname).toBe(
      '/instructor/curriculums/cur-spring-live/sections/sec-foundation/recorded-lessons/new',
    )

    const videoInput = screen.getByLabelText('MP4 영상 파일')
    await user.upload(videoInput, new File(['video'], '잘못된-영상.mov', { type: 'video/quicktime' }))
    expect(screen.getByRole('alert')).toHaveTextContent('MP4 형식의 영상 파일만 선택할 수 있습니다.')

    const video = new File(['recorded-video'], '보안-기초.mp4', { type: 'video/mp4' })
    await user.upload(videoInput, video)
    expect(screen.getAllByText('보안-기초.mp4')).toHaveLength(2)
    expect(screen.getByLabelText('보안-기초.mp4 썸네일')).toHaveAttribute('src', expect.stringMatching(/^blob:/))
    expect(screen.getByText('다른 영상으로 교체')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '영상 삭제' })).toBeInTheDocument()
    expect(screen.getByText('필수 영상이 준비되었습니다. 제목과 자료를 마지막으로 확인해 주세요.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '강의 기본 정보' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '동영상 업로드' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '업로드 세부 확인' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: '영상 삭제' }))
    expect(screen.queryByLabelText('보안-기초.mp4 썸네일')).not.toBeInTheDocument()
    expect(screen.getByText('MP4 영상 선택')).toBeInTheDocument()
    expect(screen.getByText('업로드할 MP4 영상을 선택해 주세요.')).toBeInTheDocument()
    await user.upload(screen.getByLabelText('MP4 영상 파일'), video)
    expect(screen.getByRole('button', { name: '영상 삭제' })).toBeInTheDocument()

    const material = new File(['presentation'], '보안-기초.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    await user.upload(screen.getByLabelText('녹화강의 자료 파일'), material)
    expect(screen.getByText('보안-기초.pptx')).toBeInTheDocument()
    expect(screen.getByText('1개 업로드 대기')).toBeInTheDocument()
    expect(screen.getByText('대기')).toBeInTheDocument()

    const submit = screen.getByRole('button', { name: '녹화강의 업로드' })
    expect(submit).toBeDisabled()
    await user.type(screen.getByLabelText(/강의 제목/), '녹화로 배우는 보안 기초')
    expect(submit).toBeEnabled()
    await user.click(submit)

    await waitFor(() => {
      expect(window.location.pathname).toBe('/instructor/curriculums/cur-spring-live/manage')
      expect(screen.getByText('녹화로 배우는 보안 기초')).toBeInTheDocument()
    })
    expect(screen.getByText('녹화강의를 업로드했습니다. 영상 처리가 완료되면 재생할 수 있습니다.')).toBeInTheDocument()
  })

  it('새 강의를 저장하면 구성 화면으로 돌아가 중복 생성을 막는다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/new')
    await user.type(await screen.findByLabelText(/강의 제목/), '중복 방지 강의')
    await user.type(screen.getByLabelText(/예정 시작 시각/), localDateTimeInDays(1))
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
    const approveButton = within(pendingRow!).getByRole('button', { name: '승인' })
    const rejectButton = within(pendingRow!).getByRole('button', { name: '거절' })
    expect(approveButton).toHaveClass('button', 'button--primary', 'enrollment-action-button--approve')
    expect(rejectButton).toHaveClass('button', 'button--danger', 'enrollment-action-button--reject')
    await user.click(approveButton)

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
    await user.type(scheduledAt, localDateTimeInDays(1))
    expect(submit).toBeEnabled()

    await user.click(submit)
    expect(await screen.findByText('강의 정보와 라이브 일정이 저장되었습니다.')).toBeInTheDocument()
  })

  // 이미 지난 시각으로 시작하는 라이브는 새로 만들 수 없다.
  it('라이브 예정일을 오늘보다 이전으로 넣으면 토스트로 이유를 알리고 만들지 않는다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/new')
    await user.type(await screen.findByLabelText(/강의 제목/), '지난 날짜 라이브')
    fireEvent.change(screen.getByLabelText(/예정 시작 시각/), { target: { value: localDateTimeInDays(-1) } })

    await user.click(screen.getByRole('button', { name: '강의 생성 저장' }))

    // 폼 아래 고정 문구가 아니라 토스트로 나가야 한다 — 알림 영역 안에서 찾는다.
    const toastRegion = await screen.findByRole('region', { name: '알림' })
    expect(await within(toastRegion).findByText('라이브 예정일은 오늘보다 이전일 수 없습니다.')).toBeInTheDocument()
    // 저장되지 않았으니 생성 폼에 그대로 머문다.
    expect(screen.getByRole('button', { name: '강의 생성 저장' })).toBeInTheDocument()
    expect(window.location.pathname).toMatch(/\/lessons\/new$/)
  })

  it('새 강의 폼은 예정 시작 시각에 오늘 하한선을 걸고 오늘 당일은 허용한다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/new')

    expect(await screen.findByLabelText(/예정 시작 시각/)).toHaveAttribute('min', todayLocalStart())

    await user.type(screen.getByLabelText(/강의 제목/), '오늘 시작 라이브')
    fireEvent.change(screen.getByLabelText(/예정 시작 시각/), { target: { value: localDateTimeInDays(0, '23:30') } })
    await user.click(screen.getByRole('button', { name: '강의 생성 저장' }))

    expect(await screen.findByText('강의 정보와 라이브 일정이 저장되었습니다.')).toBeInTheDocument()
  })

  // 수정에는 하한선을 걸지 않는다 — 어제 잡아 둔 라이브의 다른 항목만 고치려던 사람이 막히면 안 된다.
  it('강의 수정 화면에서는 예정 시작 시각에 하한선을 걸지 않는다', async () => {
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security/edit')

    const scheduledAt = await screen.findByLabelText(/예정 시작 시각/)
    expect(scheduledAt).not.toHaveAttribute('min')
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
    await user.type(scheduledAt, localDateTimeInDays(1))
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

  // 자료 다운로드는 앱 서버가 presigned URL로 302를 주는 경로다 — 역할별로 갈린다.
  it('강의 상세 자료 다운로드는 강사·수강생이 각자의 경로를 쓴다', async () => {
    const user = userEvent.setup()
    const fetchMaterial = vi
      .spyOn(materialDownloadService, 'fetchMaterial')
      .mockResolvedValue(new Blob(['bytes']))
    const { unmount } = await renderAsInstructor(
      '/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security',
    )

    await user.click(await screen.findByRole('button', { name: 'spring-security-basics.pptx 다운로드' }))
    // presigned URL에는 원본 파일명이 없다 — 저장될 이름을 요청이 함께 들고 가야 한다.
    expect(fetchMaterial).toHaveBeenLastCalledWith({
      scope: 'LESSON',
      parentId: 'les-security',
      materialId: 'mat-security',
      fileName: 'spring-security-basics.pptx',
      asInstructor: true,
    })
    unmount()

    await renderAsStudent('/student/curriculums/cur-spring-live/sections/sec-security/lessons/les-security')

    await user.click(await screen.findByRole('button', { name: 'spring-security-basics.pptx 다운로드' }))
    expect(fetchMaterial).toHaveBeenLastCalledWith(expect.objectContaining({ asInstructor: false }))
  })

  /*
   * 저작 화면의 다운로드도 같은 규칙을 따라야 한다. 스토리지 객체 키가 `material/{UUID}`라
   * (AssetService) presigned URL을 링크로 그냥 열면 확장자도 없는 UUID로 저장된다.
   */
  it('강의 수정 화면에서 자료를 원래 파일명으로 내려받는다', async () => {
    const user = userEvent.setup()
    const fetchMaterial = vi
      .spyOn(materialDownloadService, 'fetchMaterial')
      .mockResolvedValue(new Blob(['bytes']))
    await renderAsInstructor(
      '/instructor/curriculums/cur-spring-live/sections/sec-security/lessons/les-security/edit',
    )

    await user.click(await screen.findByRole('button', { name: 'spring-security-basics.pptx 다운로드' }))

    expect(fetchMaterial).toHaveBeenLastCalledWith({
      scope: 'LESSON',
      parentId: 'les-security',
      materialId: 'mat-security',
      fileName: 'spring-security-basics.pptx',
      asInstructor: true,
    })
  })

  it('녹화강의 수정 화면에서 자료를 원래 파일명으로 내려받는다', async () => {
    const user = userEvent.setup()
    const fetchMaterial = vi
      .spyOn(materialDownloadService, 'fetchMaterial')
      .mockResolvedValue(new Blob(['bytes']))
    // 녹화강의는 fixture에 없다(업로드로만 생긴다). UI 흐름 대신 서비스로 바로 만들어 둔다.
    const { lessonId } = await mockCurriculumManagementService.uploadRecordedLesson({
      clientRequestId: 'test-recorded-download',
      curriculumId: 'cur-spring-live',
      sectionId: 'sec-foundation',
      title: '녹화로 배우는 보안 기초',
      description: '',
      videoFile: new File(['video'], '보안-기초.mp4', { type: 'video/mp4' }),
      materials: [new File(['deck'], '보안-기초.pptx', { type: PPTX_MIME })],
    })

    await renderAsInstructor(
      `/instructor/curriculums/cur-spring-live/sections/sec-foundation/recorded-lessons/${lessonId}/edit`,
    )

    await user.click(await screen.findByRole('button', { name: '보안-기초.pptx 다운로드' }))

    expect(fetchMaterial).toHaveBeenLastCalledWith({
      scope: 'LESSON',
      parentId: lessonId,
      materialId: 'mock-material-보안-기초.pptx-4',
      fileName: '보안-기초.pptx',
      asInstructor: true,
    })
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

  /*
    대표 이미지는 고른 즉시 저장된다(ADR-0076). 예전에는 고른 파일을 버리고 미리보기만 바꿔서,
    화면은 "자동 저장됩니다"라고 말하는데 다시 들어오면 옛 이미지로 돌아가 있었다.
  */
  it('대표 이미지를 고르면 즉시 저장되고 화면을 떠났다 돌아와도 유지된다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await user.click(await screen.findByRole('tab', { name: '기본 정보' }))
    const image = new File(['image-bytes'], 'cover.png', { type: 'image/png' })

    await user.upload(screen.getByLabelText('대표 이미지 등록'), image)
    await waitFor(() => expect(screen.getByText('자동 저장됨')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByAltText('대표 이미지 미리보기')).toHaveAttribute(
      'src', expect.stringContaining('data:image/png'),
    ))

    await user.click(screen.getByRole('link', { name: '커리큘럼 상세' }))
    await user.click(await screen.findByRole('button', { name: '관리하기' }))
    await user.click(await screen.findByRole('tab', { name: '기본 정보' }))

    expect(await screen.findByAltText('대표 이미지 미리보기')).toHaveAttribute(
      'src', expect.stringContaining('data:image/png'),
    )
  })

  /**
   * 관리 화면의 대표 이미지 <b>삭제가 실제로 지운다</b>.
   *
   * <p>예전에는 이 버튼이 비활성이었다 — 저장된 이미지를 비우는 서버 계약이 없어 자리만 지키고 "준비
   * 중"이라고 말했다(ADR-0076 결정 3). 그 계약(`DELETE .../thumbnail`)이 생긴 뒤에도 화면은 옛 상태로
   * 남아, 강사는 누를 수 없는 버튼을 계속 봤다. 이 테스트가 그 역전을 고정한다.
   */
  it('관리 화면에서 대표 이미지를 삭제한다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await user.click(await screen.findByRole('tab', { name: '기본 정보' }))

    // 이미지가 있으니 지울 수 있어야 한다 — 여기가 비활성이던 자리다.
    expect(await screen.findByAltText('대표 이미지 미리보기')).toBeInTheDocument()
    const removeButton = await screen.findByRole('button', { name: '이미지 삭제' })
    expect(removeButton).toBeEnabled()

    await user.click(removeButton)

    // 미리보기가 사라지고, 지울 것이 없어져 버튼이 스스로 잠긴다.
    await waitFor(() => expect(screen.queryByAltText('대표 이미지 미리보기')).not.toBeInTheDocument())
    expect(screen.getByRole('button', { name: '이미지 삭제' })).toBeDisabled()
  })

  it('커리큘럼 만들기에서는 고른 대표 이미지를 삭제 버튼으로 취소할 수 있다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/new')

    // 아직 고른 이미지가 없어도 삭제 버튼은 등록 옆에 있다(비활성 + 이유).
    const removeButton = await screen.findByRole('button', { name: '이미지 삭제' })
    expect(removeButton).toBeDisabled()

    const image = new File(['image-bytes'], 'cover.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('대표 이미지 등록'), image)
    expect(await screen.findByAltText('대표 이미지 미리보기')).toBeInTheDocument()

    // 저장 전이라 서버에 아무것도 없다 — 여기서는 삭제가 실제로 동작한다.
    await user.click(screen.getByRole('button', { name: '이미지 삭제' }))
    expect(screen.queryByAltText('대표 이미지 미리보기')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '이미지 삭제' })).toBeDisabled()

    // 지운 뒤 같은 파일을 다시 고를 수 있어야 한다 — input.value를 비우지 않으면 브라우저가
    // "같은 값"으로 보고 change를 쏘지 않아 재등록이 막힌다.
    await user.upload(screen.getByLabelText('대표 이미지 등록'), image)
    expect(await screen.findByAltText('대표 이미지 미리보기')).toBeInTheDocument()
  })

  // 등록 경로가 미리보기 클릭뿐이면 무엇을 눌러야 하는지 화면에서 안 읽힌다 — 버튼으로 세운다.
  it('대표 이미지 등록 버튼은 이미지 유무에 따라 등록·변경으로 바뀐다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/new')
    await screen.findByRole('heading', { name: '새 커리큘럼 만들기', level: 1 })

    expect(screen.getByText('이미지 등록')).toBeInTheDocument()
    expect(screen.queryByText('이미지 변경')).not.toBeInTheDocument()

    const image = new File(['image-bytes'], 'cover.png', { type: 'image/png' })
    await user.upload(screen.getByLabelText('대표 이미지 등록'), image)
    expect(await screen.findByAltText('대표 이미지 미리보기')).toBeInTheDocument()

    expect(screen.getByText('이미지 변경')).toBeInTheDocument()
    expect(screen.queryByText('이미지 등록')).not.toBeInTheDocument()
  })

  // 자료도 자동 저장 지문에 들어간다(ADR-0042) — 고르는 즉시 목록에 뜨고, 디바운스 뒤 저장된다.
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

  /*
    자동 저장이 끝난 뒤 화면을 떠났다 돌아오면, 방금 저장한 자료 목록이 그대로 보여야 한다.

    저장 결과를 쿼리 캐시에 반영하지 않으면 staleTime(30초) 안에 다시 들어올 때 저장 전 캐시가
    그려진다 — 올린 자료가 사라져 보이고, 지운 자료가 되살아나 보이다가 30초가 지나서야 맞게
    나왔다. 로컬 state는 화면을 떠나는 순간 사라지므로 이 왕복이 아니면 잡히지 않는다.
  */
  it('자료를 자동 저장한 뒤 화면을 떠났다 돌아와도 최신 목록이 보인다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await user.click(await screen.findByRole('tab', { name: '기본 정보' }))
    const material = new File(['presentation'], 'cache-sync-guide.pptx', {
      type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    })
    await user.upload(screen.getByLabelText('커리큘럼 강의 자료 등록'), material)
    await waitFor(() => expect(screen.getByText('자동 저장됨')).toBeInTheDocument())

    // 커리큘럼 상세로 나갔다가 관리로 되돌아온다 — 실제 동선이고, 같은 QueryClient를 공유한다.
    await user.click(screen.getByRole('link', { name: '커리큘럼 상세' }))
    await user.click(await screen.findByRole('button', { name: '관리하기' }))
    await user.click(await screen.findByRole('tab', { name: '기본 정보' }))

    expect(await screen.findByText('cache-sync-guide.pptx')).toBeInTheDocument()

    // 삭제도 같은 문제의 반대 방향이었다 — 지운 자료가 되돌아왔을 때 되살아나 보였다.
    await user.click(screen.getByRole('button', { name: 'cache-sync-guide.pptx 제거' }))
    await waitFor(() => expect(screen.getByText('자동 저장됨')).toBeInTheDocument())

    await user.click(screen.getByRole('link', { name: '커리큘럼 상세' }))
    await user.click(await screen.findByRole('button', { name: '관리하기' }))
    await user.click(await screen.findByRole('tab', { name: '기본 정보' }))

    expect(await screen.findByRole('heading', { name: '커리큘럼 강의 자료' })).toBeInTheDocument()
    expect(screen.queryByText('cache-sync-guide.pptx')).not.toBeInTheDocument()
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
    // 새 커리큘럼 진입점은 목록 패널이 아니라 페이지 우측 상단 헤더에 있다.
    expect(within(operatingPanel!).queryByRole('link', { name: '새 커리큘럼' })).not.toBeInTheDocument()
    const pageHeader = screen.getByRole('heading', { name: '커리큘럼 관리', level: 1 }).closest('header')!
    expect(within(pageHeader).getByRole('link', { name: '새 커리큘럼' })).toHaveAttribute(
      'href',
      '/instructor/curriculums/new',
    )
    // 상세 진입점은 카드 제목 링크다 — 별도 "커리큘럼 상세" 버튼은 없앴다.
    const titleLinks = (await within(operatingPanel!).findAllByRole('heading', { level: 3 }))
      .map((heading) => within(heading).getByRole('link'))
    expect(titleLinks.length).toBeGreaterThan(0)
    for (const titleLink of titleLinks) {
      expect(titleLink).toHaveAttribute('href', expect.stringMatching(/^\/curriculums\/[^?]+$/))
    }
    expect(within(operatingPanel!).queryByRole('link', { name: '커리큘럼 상세' })).not.toBeInTheDocument()
    expect(within(operatingPanel!).queryByRole('link', { name: '관리하기' })).not.toBeInTheDocument()
  })

  it('강사 커리큘럼 상태 필터에 미구현 보관 상태를 노출하지 않는다', async () => {
    await renderAsInstructor('/instructor/curriculums')

    const statusFilter = await screen.findByRole('combobox', { name: '상태 필터' })
    expect(within(statusFilter).getAllByRole('option').map((option) => option.textContent))
      .toEqual(['전체 상태', '공개 중', '준비 중'])
  })

  /**
   * 운영 기간은 관리 화면에서 <b>읽고 고칠 수 있어야</b> 한다. 생성 때 기간을 놓치면(생성 POST가
   * 기간을 받지 않아 PATCH로 이어 붙인다) 다시 넣을 자리가 없어, 카탈로그 카드가 영구히
   * "일정 준비 중"에 머물렀다.
   */
  it('관리 화면 기본 정보 탭에서 저장된 운영 기간을 읽는다', async () => {
    const user = userEvent.setup()
    // cur-spring-live 시드 기간: 2026-08-03T19:00+09:00 ~ 2026-09-24T21:00+09:00 (KST 고정).
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await user.click(await screen.findByRole('tab', { name: '기본 정보' }))

    // 서버가 준 ISO를 datetime-local이 그대로 받는 지역 시각으로 되읽는다 — UTC로 자르면 19:00이 10:00이 된다.
    expect(await screen.findByLabelText('운영 시작일')).toHaveValue('2026-08-03T19:00')
    expect(screen.getByLabelText('운영 종료일')).toHaveValue('2026-09-24T21:00')
    // 입력칸이 곧 답이라 같은 날짜를 문장으로 되읽지 않는다 — 되읽기는 처음 만드는 화면의 몫이다.
    expect(screen.queryByText(/주 과정$/)).not.toBeInTheDocument()
  })

  it('관리 화면에서 운영 기간을 고치면 자동 저장된다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await user.click(await screen.findByRole('tab', { name: '기본 정보' }))
    await screen.findByLabelText('운영 시작일')

    const newEndsAt = localDateTimeInDays(30, '22:00')
    fireEvent.change(screen.getByLabelText('운영 종료일'), { target: { value: newEndsAt } })

    await waitFor(() => expect(screen.getByText('자동 저장됨')).toBeInTheDocument())
    expect(getMockCurriculum('cur-spring-live')?.period?.endsAt).toBe(new Date(newEndsAt).toISOString())
  })

  /**
   * 기간이 반쪽이면 그것만 미루고 <b>나머지 기본 정보는 계속 저장한다</b>. 저장 전체를 막으면
   * 기간을 고치는 동안 제목·소개 수정이 조용히 사라진다.
   */
  it('운영 기간이 반쪽이면 이유를 알리고 기간만 저장을 미룬다', async () => {
    const user = userEvent.setup()
    await renderAsInstructor('/instructor/curriculums/cur-spring-live/manage')
    await user.click(await screen.findByRole('tab', { name: '기본 정보' }))
    await screen.findByLabelText('운영 시작일')
    const before = getMockCurriculum('cur-spring-live')?.period

    fireEvent.change(screen.getByLabelText('운영 시작일'), { target: { value: '' } })
    const title = screen.getByDisplayValue('라이브로 완성하는 Spring Boot')
    fireEvent.change(title, { target: { value: '기간을 고치는 중인 커리큘럼' } })

    expect(await screen.findByText(/운영 시작일과 종료일을 함께 입력해 주세요/)).toBeInTheDocument()
    await waitFor(() => expect(screen.getByText('자동 저장됨')).toBeInTheDocument())
    // 제목은 저장됐고, 기간은 건드리지 않았다(PATCH의 null = 변경 안 함).
    expect(getMockCurriculum('cur-spring-live')?.title).toBe('기간을 고치는 중인 커리큘럼')
    expect(getMockCurriculum('cur-spring-live')?.period).toEqual(before)
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
    await user.click(screen.getByRole('button', { name: '공개 프로필 수정' }))
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
  it('학생 프로필 수정 모달에서 이미지와 닉네임을 함께 변경한다', async () => {
    const user = userEvent.setup()
    await renderAsStudent('/student/profile')

    await user.click(await screen.findByRole('button', { name: '프로필 수정' }))
    const dialog = await screen.findByRole('dialog', { name: '프로필 수정' })
    const displayName = within(dialog).getByDisplayValue('김학생')
    await user.clear(displayName)
    await user.type(displayName, '김라이브')

    const image = new File(['profile-image'], 'profile.png', { type: 'image/png' })
    await user.upload(within(dialog).getByLabelText('프로필 이미지 선택'), image)
    await user.click(within(dialog).getByRole('button', { name: '변경사항 저장' }))

    expect(await screen.findByText('기본 프로필이 변경되었습니다.')).toBeInTheDocument()
    // 상단 프로필 카드의 아바타가 바뀐 이미지·이름으로 갱신된다.
    const identityCard = screen.getByRole('region', { name: '김라이브' })
    expect(within(identityCard).getByRole('img', { name: '김라이브 프로필 이미지' }).querySelector('img')).not.toBeNull()
    // 저장한 뒤에는 바뀐 것이 없으므로 다시 저장할 수 없다.
    expect(screen.queryByRole('dialog', { name: '프로필 수정' })).not.toBeInTheDocument()
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

  /**
   * 배지는 보는 사람의 관점을 따른다 — 학생에게 커리큘럼이 "공개 중"인지는 강사의 사정이고, 학생이
   * 확인하려는 것은 자기가 수강 중이라는 사실이다. 상태 필터도 같은 말("수강 중")을 써야 한다.
   */
  it('학생 내 커리큘럼은 신청 대기·학습 중·학습 완료를 한 목록에서 필터링한다', async () => {
    await renderAsStudent('/student/curriculums')
    const learningHeading = await screen.findByRole('heading', { name: '나의 커리큘럼' })
    const learningPanel = learningHeading.closest('section')!

    expect(await within(learningPanel).findByText('학습 중')).toBeInTheDocument()
    expect(within(learningPanel).getAllByText('수강 신청 대기 중')).toHaveLength(2)
    expect(within(learningPanel).queryByText('공개 중')).not.toBeInTheDocument()
    expect(within(within(learningPanel).getByRole('combobox', { name: '상태 필터' })).getAllByRole('option')
      .map((option) => option.textContent))
      .toEqual(['전체 상태', '수강 신청 대기 중', '학습 중', '학습 완료'])
  })

  it('학생 내 커리큘럼의 신청 대기 카드는 학습 진행 정보 없이 표시한다', async () => {
    await renderAsStudent('/student/curriculums')
    const heading = await screen.findByRole('heading', { name: '나의 커리큘럼' })
    const section = heading.closest('section')

    expect(section).not.toBeNull()
    const pendingSection = within(section!)
    const pendingCard = (await pendingSection.findByRole('heading', { name: '성능을 바꾸는 SQL 튜닝' })).closest('article')!
    expect(within(pendingCard).getByText('수강 신청 대기 중')).toBeInTheDocument()
    expect(within(pendingCard).queryByRole('link', { name: '학습 계속하기' })).not.toBeInTheDocument()
    expect(within(pendingCard).queryByText(/강의$/)).not.toBeInTheDocument()
    expect(within(pendingCard).getByRole('link', { name: '성능을 바꾸는 SQL 튜닝' })).toHaveAttribute('href', '/curriculums/cur-sql')
    expect(within(pendingCard).getByRole('button', { name: '수강 신청 취소' })).toBeInTheDocument()
  })
})
