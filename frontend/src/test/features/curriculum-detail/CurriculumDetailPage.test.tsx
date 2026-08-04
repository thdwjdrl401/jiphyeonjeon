import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthProvider } from '@/features/auth/AuthContext'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import { ApiError } from '@/shared/api/client'
import { ToastProvider } from '@/shared/ui/Toast'
import CurriculumDetailPage from '@/pages/CurriculumDetailPage'
import LoginPage from '@/pages/LoginPage'
import * as enrollmentService from '@/features/enrollment/enrollmentService'
import {
  MOCK_ERROR_CURRICULUM_ID,
  resetMockCurriculumDetails,
} from '@/features/curriculum-detail/mockCurriculumDetails'

function renderDetail(path: string) {
  window.history.pushState({}, '', path)
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ToastProvider>
            <Routes>
              <Route path="/curriculums/:curriculumId" element={<CurriculumDetailPage />} />
              <Route path="/curriculums" element={<div>커리큘럼 목록 페이지</div>} />
              <Route
                path="/instructor/curriculums/:curriculumId/manage"
                element={<div>커리큘럼 관리 페이지</div>}
              />
              <Route path="/login" element={<LoginPage />} />
            </Routes>
          </ToastProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>,
  )
}

describe('CurriculumDetailPage', () => {
  beforeEach(() => {
    resetMockAuth()
    resetMockCurriculumDetails()
    window.history.replaceState({}, '', '/')
  })

  it('비로그인 사용자도 공개 상세 정보를 볼 수 있다', async () => {
    renderDetail('/curriculums/cur-spring-live')

    expect(
      await screen.findByRole('heading', { name: '라이브로 완성하는 Spring Boot' }),
    ).toBeInTheDocument()
    expect(screen.getByText('1. 오리엔테이션과 개발 환경')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수강 신청' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '관리하기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '담당 커리큘럼 관리' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '담당 강사' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '커리큘럼 강의 자료' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '라이브 시작 알림 설정' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '로그인 후 수강하기' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: '로그인하기' })).toBeInTheDocument()
    expect(screen.getByText('라이브 예정')).toBeInTheDocument()
    expect(document.querySelectorAll('a.curriculum-lesson__detail-area')).toHaveLength(0)
    expect(document.querySelectorAll('.curriculum-lesson__detail-area--disabled').length).toBeGreaterThan(0)
    expect(screen.queryByText('수강 승인 후 이용')).not.toBeInTheDocument()
  })

  it('첫 섹션만 펼친 뒤 전체 목차를 한 번에 펼치거나 접을 수 있다', async () => {
    const user = userEvent.setup()
    renderDetail('/curriculums/cur-spring-live')

    const expandAllButton = await screen.findByRole('button', { name: '모두 펼치기' })
    expect(screen.getAllByRole('button', { expanded: false }).length).toBeGreaterThan(0)

    await user.click(expandAllButton)

    expect(screen.getByRole('button', { name: '모두 접기' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { expanded: false })).not.toBeInTheDocument()
  })

  it('비로그인 사용자가 로그인 CTA를 누르면 returnTo를 보존한 채 로그인으로 이동한다', async () => {
    const user = userEvent.setup()
    renderDetail('/curriculums/cur-spring-live')

    const loginLink = await screen.findByRole('link', { name: '로그인하기' })
    await user.click(loginLink)

    await waitFor(() => expect(window.location.pathname).toBe('/login'))
    expect(window.location.search).toContain('returnTo=%2Fcurriculums%2Fcur-spring-live')
  })

  it('내 커리큘럼의 데이터 시각화는 상세에서도 수강 중으로 유지된다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-data-story')

    expect(await screen.findByText('학습 진행률')).toBeInTheDocument()
    expect(screen.getByText('75%')).toBeInTheDocument()
    expect(screen.getByText('수강 중')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수강 취소' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '이어보기' })).not.toBeInTheDocument()
  })

  it('수강생에게는 진행률과 수강 상태·취소 CTA가 보인다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    expect(await screen.findByText('학습 진행률')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '커리큘럼 강의 자료' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '자료 목록' })).toBeInTheDocument()
    expect(screen.queryByText('Spring Boot 커리큘럼 가이드.pptx')).not.toBeInTheDocument()
    expect(screen.getByText('수강 중')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수강 취소' })).toBeInTheDocument()
  })

  it('수강생은 공개 상태 왼쪽 알림 버튼에서 커리큘럼 알림 설정을 연다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    const trigger = await screen.findByRole('button', { name: '라이브 시작 알림 설정' })
    const triggerContainer = trigger.closest('.live-reminder-popover')
    expect(triggerContainer?.nextElementSibling).toHaveClass('curriculum-lifecycle-badge')
    expect(screen.queryByRole('dialog', { name: '라이브 시작 알림' })).not.toBeInTheDocument()

    await user.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '라이브 시작 알림' })
    const checkbox = await within(dialog).findByRole('checkbox', { name: '미리 알림 받기' })
    expect(checkbox).toBeChecked()
    expect(within(dialog).getByRole('combobox')).toHaveValue('10')

    await user.click(checkbox)
    await waitFor(() => expect(trigger).toHaveAccessibleName('라이브 시작 알림 설정 (꺼짐)'))
    expect(trigger.querySelector('.live-reminder-popover__slash')).toBeInTheDocument()

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: '라이브 시작 알림' })).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
  })

  it('수강 중인 커리큘럼을 취소하면 미수강 상태로 갱신한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    await user.click(await screen.findByRole('button', { name: '수강 취소' }))

    expect(await screen.findByRole('button', { name: '수강 신청하기' })).toBeInTheDocument()
    expect(screen.queryByText('학습 진행률')).not.toBeInTheDocument()
    expect(document.querySelectorAll('a.curriculum-lesson__detail-area')).toHaveLength(0)
    expect(document.querySelectorAll('.curriculum-lesson__detail-area--disabled').length).toBeGreaterThan(0)
  })

  it('미수강 학생의 수강 신청 카드는 강의 자료 카드 디자인으로 소개 위에 표시된다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-typescript')

    const enrollmentHeading = await screen.findByRole('heading', { name: '수강 신청' })
    const enrollmentCard = enrollmentHeading.closest('section')
    const overviewCard = screen.getByRole('heading', { name: '커리큘럼 소개' }).closest('section')

    expect(enrollmentCard).toHaveClass('curriculum-materials', 'enrollment-actions')
    expect(within(enrollmentCard!).getByRole('button', { name: '수강 신청하기' })).toBeInTheDocument()
    expect(enrollmentCard?.nextElementSibling).toBe(overviewCard)
  })

  it('수강생 목차는 담당 강사와 같은 행 링크와 라이브 상태 태그를 사용한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    const lessonRow = await screen.findByRole('link', { name: '1. 오리엔테이션과 개발 환경 강의 상세' })
    expect(lessonRow).toHaveAttribute(
      'href',
      '/student/curriculums/cur-spring-live/sections/sec-foundation/lessons/les-orientation',
    )
    await user.click(screen.getByRole('button', { name: '모두 펼치기' }))
    expect(screen.queryByText('게시됨')).not.toBeInTheDocument()
    expect(screen.queryByText('완료')).not.toBeInTheDocument()
    expect(screen.getAllByText('라이브 예정').length).toBeGreaterThan(0)
    expect(screen.getAllByText('LIVE').length).toBeGreaterThan(0)
    expect(screen.queryByRole('link', { name: '강의 수정' })).not.toBeInTheDocument()
    expect(screen.queryByText('강의 상세')).not.toBeInTheDocument()
  })

  it('지난 강의도 커리큘럼 목차에서는 강의 상세로 연결된다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    await screen.findByText('학습 진행률')
    const detailLinks = screen.getAllByRole('link', { name: /강의 상세$/ })
    expect(detailLinks.length).toBeGreaterThan(0)
    for (const link of detailLinks) {
      expect(link).toHaveAttribute('href', expect.stringMatching(/^\/student\/curriculums\/.+\/sections\/.+\/lessons\/.+$/))
    }
  })

  it('완료 직후 바로 다음 예정 강의는 라이브 준비 안내 페이지로 연결된다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    await user.click(await screen.findByRole('button', { name: '모두 펼치기' }))
    const nextUpLink = await screen.findByRole('link', { name: /^7\. 7강\. 학습 주제 7 강의 상세$/ })
    expect(nextUpLink).toHaveAttribute(
      'href',
      '/student/curriculums/cur-spring-live/sections/cur-spring-live-section-3/lessons/cur-spring-live-lesson-7',
    )
  })

  it('수강 중이지만 아직 강의를 하나도 듣지 않아도 수강 상태 배지를 보여준다', async () => {
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-react-system')

    expect(await screen.findByText('학습 진행률')).toBeInTheDocument()
    expect(screen.getByText('0%')).toBeInTheDocument()
    expect(screen.getByText('수강 중')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수강 취소' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '수강하기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '이어보기' })).not.toBeInTheDocument()
  })

  it('담당 강사 목차는 행 영역을 상세로 연결하고 우측에 강의 수정 버튼을 둔다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'instructor01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    await user.click(await screen.findByRole('button', { name: '모두 펼치기' }))
    const editLinks = await screen.findAllByRole('link', { name: '강의 수정' })
    expect(editLinks.length).toBeGreaterThan(0)
    for (const link of editLinks) {
      expect(link).toHaveAttribute('href', expect.stringMatching(/^\/instructor\/curriculums\/.+\/sections\/.+\/lessons\/.+\/edit$/))
    }
    const detailAreas = document.querySelectorAll<HTMLAnchorElement>('.curriculum-lesson__detail-area')
    expect(detailAreas.length).toBe(editLinks.length)
    for (const link of detailAreas) {
      expect(link).toHaveAttribute('href', expect.stringMatching(/^\/instructor\/curriculums\/.+\/sections\/.+\/lessons\/[^/]+$/))
    }
    expect(screen.queryByText('강의 상세')).not.toBeInTheDocument()
    // 일정이 잡힌 라이브와 실제 방송 중인 라이브만 태그를 표시한다.
    expect(screen.queryByText('게시됨')).not.toBeInTheDocument()
    expect(screen.queryByText('준비 중')).not.toBeInTheDocument()
    const scheduledTags = screen.getAllByText('라이브 예정')
    const liveTags = screen.getAllByText('LIVE')
    expect(scheduledTags.length).toBeGreaterThan(0)
    expect(liveTags.length).toBeGreaterThan(0)
    expect(scheduledTags[0]).toHaveClass('curriculum-lifecycle-badge', 'curriculum-lesson__state--scheduled')
    expect(liveTags[0]).toHaveClass('curriculum-lifecycle-badge', 'curriculum-lesson__state--live')
    expect(screen.queryByText('라이브 일정 준비 중')).not.toBeInTheDocument()
    expect(screen.queryByText('다시보기 준비 중')).not.toBeInTheDocument()
    expect(screen.queryByText('다시보기 가능')).not.toBeInTheDocument()
    expect(screen.queryByText('입장 가능')).not.toBeInTheDocument()
    expect(screen.queryByText('라이브 진행 중')).not.toBeInTheDocument()
  })

  it('게시되지 않은 강의의 학생 공개 상태는 준비 중으로 표시한다', async () => {
    await mockAuthService.login({ email: 'instructor01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-architecture')

    expect((await screen.findAllByText('준비 중')).length).toBeGreaterThan(0)
    expect(screen.queryByText('초안')).not.toBeInTheDocument()
    expect(screen.queryByText('게시 준비')).not.toBeInTheDocument()
  })

  // 관리 진입점은 보조 정보 영역의 안내 카드 하나뿐이다(제목 카드·하단 패널 중복 제거).
  it('담당 강사에게 관리 안내 카드를 관리 기능의 유일한 진입점으로 보여준다', async () => {
    await mockAuthService.login({ email: 'instructor01@example.com', password: 'password1' })
    const { unmount } = renderDetail('/curriculums/cur-spring-live')

    const managementHeading = await screen.findByRole('heading', { name: '담당 커리큘럼 관리' })
    const managementCard = managementHeading.closest('section')
    expect(managementCard).not.toBeNull()

    const sidebar = managementCard!.parentElement
    const overviewCard = sidebar?.querySelector('.curriculum-overview') ?? null
    const materialsCard = sidebar?.querySelector('.curriculum-materials') ?? null
    expect(sidebar).not.toBeNull()
    expect(overviewCard).not.toBeNull()
    expect(materialsCard).not.toBeNull()

    const sidebarCards = Array.from(sidebar!.children)
    expect(sidebarCards.indexOf(managementCard!)).toBeLessThan(sidebarCards.indexOf(materialsCard!))
    expect(sidebarCards.indexOf(materialsCard!)).toBeLessThan(sidebarCards.indexOf(overviewCard!))

    expect(within(managementCard!).getByText('이 커리큘럼을 관리하고 강의를 편성할 수 있어요.')).toBeInTheDocument()

    expect(screen.getAllByRole('button', { name: '관리하기' })).toHaveLength(1)
    expect(within(managementCard!).getByRole('button', { name: '관리하기' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: '커리큘럼 관리' })).not.toBeInTheDocument()

    expect(screen.getByRole('heading', { name: '커리큘럼 강의 자료' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '자료 목록' })).toBeInTheDocument()
    expect(screen.queryByText('공통 실습 환경 설정.pptx')).not.toBeInTheDocument()
    unmount()
  })

  it('관리 안내 카드의 관리하기를 누르면 커리큘럼 관리 페이지로 이동한다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'instructor01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-spring-live')

    await user.click(await screen.findByRole('button', { name: '관리하기' }))

    await waitFor(() =>
      expect(window.location.pathname).toBe('/instructor/curriculums/cur-spring-live/manage'),
    )
  })

  it('담당하지 않는 강사에게는 같은 자리에 버튼 없는 안내 카드만 보여준다', async () => {
    await mockAuthService.login({ email: 'instructor01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-data-story')

    await screen.findByRole('heading', { name: '데이터로 설득하는 시각화' })
    const noticeHeading = screen.getByRole('heading', { name: '다른 강사가 운영하는 커리큘럼이에요' })
    const noticeCard = noticeHeading.closest('section')
    expect(noticeCard).not.toBeNull()
    expect(within(noticeCard!).getByText('이 커리큘럼은 강사 계정으로 수강할 수 없어요.')).toBeInTheDocument()
    expect(within(noticeCard!).queryByRole('button')).not.toBeInTheDocument()

    expect(screen.queryByRole('button', { name: '관리하기' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '담당 커리큘럼 관리' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '커리큘럼 강의 자료' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '수강 신청' })).not.toBeInTheDocument()
  })

  it('승인제 수강 신청 성공 후에는 승인 대기 상태로 갱신된다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-ux-research')

    const enrollButton = await screen.findByRole('button', { name: '수강 신청하기' })
    await user.click(enrollButton)

    const pendingHeading = await screen.findByRole('heading', { name: '승인 대기 중이에요' })
    const pendingCard = pendingHeading.closest('section')
    const overviewCard = screen.getByRole('heading', { name: '커리큘럼 소개' }).closest('section')

    expect(pendingCard).toHaveClass('curriculum-materials', 'enrollment-pending-notice')
    expect(within(pendingCard!).getByRole('button', { name: '수강 신청 취소' })).toBeInTheDocument()
    expect(pendingCard?.nextElementSibling).toBe(overviewCard)
  })

  it('즉시 수강 커리큘럼은 신청 직후 수강 중 상태로 갱신된다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-typescript')

    expect(await screen.findByText('신청 즉시 수강을 시작할 수 있어요.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: '수강 신청하기' }))

    expect(await screen.findByText('수강 중')).toBeInTheDocument()
    expect(screen.queryByText('승인 대기 중이에요')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수강 취소' })).toBeInTheDocument()
  })

  it('승인 대기 → 취소 → 재신청까지 버튼이 이어진다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    renderDetail('/curriculums/cur-sql')

    // 승인 대기 카드의 취소 버튼이 동작한다
    expect(await screen.findByText('승인 대기 중이에요')).toBeInTheDocument()
    const cancelButton = screen.getByRole('button', { name: '수강 신청 취소' })
    await user.click(cancelButton)

    // 취소 후 다시 수강 신청 상태로 돌아온다
    expect(await screen.findByRole('button', { name: '수강 신청하기' })).toBeInTheDocument()
    expect(screen.queryByText('승인 대기 중이에요')).not.toBeInTheDocument()

    // 다시 신청하면 승인 대기 상태로 되돌아간다
    await user.click(screen.getByRole('button', { name: '수강 신청하기' }))
    expect(await screen.findByText('승인 대기 중이에요')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: '수강 신청 취소' })).toBeInTheDocument()
  })

  it('수강 신청 중에는 버튼이 로딩 상태로 바뀌고 완료되면 정상 반영된다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })

    let resolveEnroll: (value: Awaited<ReturnType<typeof enrollmentService.enrollInCurriculum>>) => void = () => {}
    const pending = new Promise<Awaited<ReturnType<typeof enrollmentService.enrollInCurriculum>>>((resolve) => {
      resolveEnroll = resolve
    })
    const spy = vi.spyOn(enrollmentService, 'enrollInCurriculum').mockReturnValue(pending)

    renderDetail('/curriculums/cur-ux-research')
    const enrollButton = await screen.findByRole('button', { name: '수강 신청하기' })
    await user.click(enrollButton)

    await waitFor(() => expect(screen.getAllByRole('button', { name: /신청 중/ }).length).toBeGreaterThan(0))
    for (const button of screen.getAllByRole('button', { name: /신청 중/ })) {
      expect(button).toBeDisabled()
    }

    resolveEnroll({
      enrollmentId: 'enr_test_loading',
      curriculumId: 'cur-ux-research',
      userId: 'usr_test_loading',
      status: 'ACTIVE',
      requestedAt: '2026-07-20T12:00:00+09:00',
      decidedAt: '2026-07-20T12:00:00+09:00',
      enrolledAt: '2026-07-20T12:00:00+09:00',
    })

    await waitFor(() => expect(screen.queryByRole('button', { name: /신청 중/ })).not.toBeInTheDocument())
    spy.mockRestore()
  })

  // 실패 알림은 토스트로 낸다(폼 옆 인라인 오류가 아니라) — 서버가 준 이유를 그대로 보여 준다.
  it('수강 신청이 실패하면 토스트로 알리고 다시 시도할 수 있다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })

    const spy = vi
      .spyOn(enrollmentService, 'enrollInCurriculum')
      .mockRejectedValue(new ApiError('이미 신청했거나 수강 중이에요.', 409, 'ENROLLMENT_ALREADY_EXISTS'))

    renderDetail('/curriculums/cur-ux-research')
    const enrollButton = await screen.findByRole('button', { name: '수강 신청하기' })
    await user.click(enrollButton)

    const toastRegion = await screen.findByRole('region', { name: '알림' })
    expect(await within(toastRegion).findByText('이미 신청했거나 수강 중이에요.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '수강 신청하기' })).not.toBeDisabled()
    spy.mockRestore()
  })

  it('존재하지 않는 커리큘럼은 404 안내를 보여준다', async () => {
    renderDetail('/curriculums/cur-does-not-exist')

    expect(await screen.findByText('커리큘럼을 찾을 수 없어요')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '커리큘럼 목록으로' })).toBeInTheDocument()
  })

  it('조회 실패 시 재시도 가능한 오류 화면을 보여준다', async () => {
    renderDetail(`/curriculums/${MOCK_ERROR_CURRICULUM_ID}`)

    expect(await screen.findByText('커리큘럼을 불러오지 못했어요')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '다시 시도' })).toBeInTheDocument()
  })
})
