import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'

// vidstack/hls.js는 jsdom에서 재생 경로를 세울 수 없다. 이 파일이 보는 것은 이동 결과뿐이다.
vi.mock('@/features/live-session/PlaybackPlayer', () => ({
  default: () => <div aria-label="강의 영상" role="region" />,
}))

function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

async function loginAsStudent() {
  return mockAuthService.login({ email: 'student@example.com', password: 'password' })
}

async function loginAsInstructor() {
  return mockAuthService.login({ email: 'teacher@liveclass.ai', password: 'password' })
}

function bell() {
  return screen.getByRole('button', { name: /^알림/ })
}

async function openDropdown(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await waitFor(() => bell()))
  return screen.getByRole('dialog', { name: '알림' })
}

/**
 * 알림 센터의 사용자 흐름.
 *
 * <p>서비스 단위 테스트가 "어떤 알림이 생기는가"를 보므로 여기서는 <b>화면에서 무엇이 되는가</b>만
 * 본다: 배지 숫자, 드롭다운, 클릭 후 도착 화면과 그 화면의 초기 상태, 접근 불가 알림 처리.
 */
describe('알림 센터', () => {
  beforeEach(() => {
    resetMockAuth()
    window.history.replaceState({}, '', '/')
  })

  it('로그인하지 않으면 헤더에 알림이 없다', async () => {
    renderAt('/')

    expect(await screen.findByRole('link', { name: '로그인' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^알림/ })).not.toBeInTheDocument()
  })

  it('읽지 않은 알림 개수가 헤더 배지에 반영되고 모두 읽음으로 사라진다', async () => {
    const user = userEvent.setup()
    await loginAsInstructor()
    renderAt('/instructor/curriculums')

    // 강사 seed의 읽지 않은 알림 수. 정확한 수를 접근성 이름으로도 읽을 수 있어야 한다.
    await waitFor(() => expect(bell()).toHaveAccessibleName('알림 (읽지 않음 5건)'))
    expect(bell()).toHaveTextContent('5')

    const dropdown = await openDropdown(user)
    await user.click(within(dropdown).getByRole('button', { name: '모두 읽음' }))

    await waitFor(() => expect(bell()).toHaveAccessibleName('알림'))
  })

  it('드롭다운은 최근 알림과 확인 필요 표시를 보여 주고 전체 알림 보기로 이어진다', async () => {
    const user = userEvent.setup()
    await loginAsInstructor()
    renderAt('/instructor/curriculums')

    const dropdown = await openDropdown(user)
    const list = await within(dropdown).findByRole('list', { name: '최근 알림' })

    expect(within(list).getByText('새로운 수강 신청이 있습니다.')).toBeInTheDocument()
    expect(within(list).getAllByText('확인 필요').length).toBeGreaterThan(0)
    // 드롭다운은 "최근"만 — 전체 이력은 페이지가 맡는다.
    expect(within(list).getAllByRole('listitem')).toHaveLength(5)

    await user.click(within(dropdown).getByRole('link', { name: '전체 알림 보기' }))

    expect(await screen.findByRole('heading', { name: '알림', level: 1 })).toBeInTheDocument()
    expect(window.location.pathname).toBe('/instructor/notifications')
  })

  it('수강 신청 알림을 누르면 수강생 탭의 승인 대기 목록에서 신청자가 강조된다', async () => {
    const user = userEvent.setup()
    await loginAsInstructor()
    renderAt('/instructor/curriculums')

    const dropdown = await openDropdown(user)
    await user.click(await within(dropdown).findByRole('button', { name: /새로운 수강 신청이 있습니다/ }))

    // 관리 화면 → 수강생 탭 → 승인 대기 필터가 URL에 남아야 새로고침·공유에도 같은 화면이 열린다.
    await waitFor(() => {
      expect(window.location.pathname).toBe('/instructor/curriculums/cur-spring-live/manage')
    })
    expect(window.location.search).toContain('tab=enrollees')
    expect(window.location.search).toContain('enrollmentStatus=PENDING')

    expect(await screen.findByRole('tab', { name: '수강생', selected: true })).toBeInTheDocument()
    expect(await screen.findByLabelText('수강 상태 필터')).toHaveValue('PENDING')
    const applicantCell = await screen.findByText('수강생-21B3')
    expect(applicantCell.closest('tr')).toHaveClass('is-highlighted')
  })

  it('알림을 누르면 읽음이 되지만 처리 상태는 그대로 남는다', async () => {
    const user = userEvent.setup()
    await loginAsInstructor()
    renderAt('/instructor/curriculums')

    const dropdown = await openDropdown(user)
    await user.click(await within(dropdown).findByRole('button', { name: /새로운 수강 신청이 있습니다/ }))
    await waitFor(() => expect(bell()).toHaveAccessibleName('알림 (읽지 않음 4건)'))

    renderAt('/instructor/notifications')
    await user.click(await screen.findByRole('tab', { name: '처리 필요' }))
    const list = await screen.findByRole('list', { name: '알림 목록' })

    // 읽었어도 승인·거절을 하지 않았으므로 "처리 필요"에 그대로 있어야 한다.
    expect(within(list).getByText('새로운 수강 신청이 있습니다.')).toBeInTheDocument()
  })

  it('삭제된 대상 알림을 눌러도 이동하지 않고 안내만 뜬다', async () => {
    const user = userEvent.setup()
    await loginAsStudent()
    renderAt('/student/notifications')

    // 오래된 알림이라 첫 페이지에 없다 — 목록을 한 페이지씩 받는다는 사실이 여기서도 드러난다.
    await user.click(await screen.findByRole('button', { name: '더 보기' }))
    const list = await screen.findByRole('list', { name: '알림 목록' })
    await user.click(await within(list).findByRole('button', { name: /삭제된 보충 강의/ }))

    expect(await screen.findByText('삭제되었거나 더 이상 접근할 수 없는 알림입니다.')).toBeInTheDocument()
    expect(window.location.pathname).toBe('/student/notifications')
    // 처리 축이 만료로 내려가 "처리 필요" 목록에 남지 않는다.
    await waitFor(() => expect(within(list).getByText('만료됨')).toBeInTheDocument())
  })

  it('다시보기 공개 알림을 누르면 학생 다시보기 화면으로 간다', async () => {
    const user = userEvent.setup()
    await loginAsStudent()
    renderAt('/student/notifications')

    const list = await screen.findByRole('list', { name: '알림 목록' })
    await user.click(within(list).getAllByRole('button', { name: /다시보기 강의가 공개되었습니다/ })[0])

    await waitFor(() => expect(window.location.pathname).toMatch(/^\/student\/lessons\/.+\/replay$/))
  })

  it('알림 페이지는 필터별 빈 상태와 더 보기를 처리한다', async () => {
    const user = userEvent.setup()
    await loginAsStudent()
    renderAt('/student/notifications')

    // 첫 페이지가 전체를 담지 않는다 — 목록을 한 번에 다 불러오지 않는다.
    const moreButton = await screen.findByRole('button', { name: '더 보기' })
    const before = within(await screen.findByRole('list', { name: '알림 목록' })).getAllByRole('listitem').length
    await user.click(moreButton)
    await waitFor(() => {
      const after = within(screen.getByRole('list', { name: '알림 목록' })).getAllByRole('listitem').length
      expect(after).toBeGreaterThan(before)
    })

    await user.click(screen.getByRole('button', { name: '모두 읽음' }))
    await user.click(screen.getByRole('tab', { name: '읽지 않음' }))

    expect(await screen.findByText('읽지 않은 알림이 없습니다.')).toBeInTheDocument()
  })
})
