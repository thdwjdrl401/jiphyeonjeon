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

  it('드롭다운은 최근 알림과 처리 대기 표시를 보여 주고 전체 알림 보기로 이어진다', async () => {
    const user = userEvent.setup()
    await loginAsInstructor()
    renderAt('/instructor/curriculums')

    const dropdown = await openDropdown(user)
    const list = await within(dropdown).findByRole('list', { name: '최근 알림' })

    expect(within(list).getByText('새로운 수강 신청이 있습니다.')).toBeInTheDocument()
    expect(within(list).getAllByText('처리 대기').length).toBeGreaterThan(0)
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
    await user.click(await screen.findByRole('tab', { name: /처리 대기/ }))
    // 방금 읽었으므로 기본 탭(읽지 않음)에는 없고, `읽음` 탭으로 넘어가야 보인다.
    await user.click(screen.getByRole('tab', { name: '읽음' }))
    const list = await screen.findByRole('list', { name: '알림 목록' })

    /*
      읽었어도 승인·거절을 하지 않았으므로 처리 대기에 그대로 있어야 한다.
      두 축을 한 값으로 합쳤다면 이 줄은 목록에서 사라졌을 것이다.
    */
    expect(within(list).getByText('새로운 수강 신청이 있습니다.')).toBeInTheDocument()
    expect(within(list).getByText('처리 대기')).toBeInTheDocument()
  })

  it('머리말에는 숫자를 두지 않고 건수를 탭에 붙인다', async () => {
    await loginAsInstructor()
    renderAt('/instructor/notifications')

    const pageHeader = (await screen.findByRole('heading', { name: '알림', level: 1 })).closest('header')
    expect(pageHeader).not.toBeNull()

    /*
      같은 숫자를 머리말과 탭에 두 번 두면, 머리말 숫자는 누를 수 없어서 "그것만 보려면 어디로
      가야 하나"를 다시 찾게 된다. 숫자는 이동 수단인 탭에만 둔다.
    */
    expect(within(pageHeader!).queryByText('4')).toBeNull()
    expect(within(pageHeader!).queryByRole('button', { name: '모두 읽음' })).toBeNull()

    // 강사 seed: 읽지 않음 5건 · 처리 대기 3건. 건수는 목록 응답과 함께 도착한다.
    expect(await screen.findByRole('tab', { name: /읽지 않음\s*5/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /처리 대기\s*3/ })).toBeInTheDocument()
  })

  it('학생에게는 처리 대기 탭을 내지 않고 읽음 축만 남긴다', async () => {
    await loginAsStudent()
    renderAt('/student/notifications')

    await screen.findByRole('list', { name: '알림 목록' })
    // 학생은 ACTION_REQUIRED 알림을 받지 않으므로 항상 빈 탭이 된다.
    expect(screen.queryByRole('tab', { name: /처리 대기/ })).toBeNull()
    expect(screen.queryByRole('tab', { name: '전체' })).toBeNull()
    // 읽음 축은 역할과 무관하게 남는다.
    expect(screen.getByRole('tab', { name: /읽지 않음/, selected: true })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '읽음' })).toBeInTheDocument()
  })

  it('읽지 않음 탭이 먼저 열려 있다', async () => {
    await loginAsStudent()
    renderAt('/student/notifications')

    // 알림 페이지에 들어오는 이유는 대개 아직 안 본 것을 보려는 것이다.
    expect(await screen.findByRole('tab', { name: /읽지 않음/, selected: true })).toBeInTheDocument()
    const rows = within(await screen.findByRole('list', { name: '알림 목록' })).getAllByRole('listitem')
    rows.forEach((row) => expect(row).toHaveClass('is-unread'))
  })

  it('두 필터 축이 겹쳐서 동작한다', async () => {
    const user = userEvent.setup()
    await loginAsInstructor()
    renderAt('/instructor/notifications')

    // 1차 = 무엇을 볼지, 2차 = 어떻게 볼지. 둘은 조합된다.
    await user.click(await screen.findByRole('tab', { name: /처리 대기/ }))

    const list = await screen.findByRole('list', { name: '알림 목록' })
    const rows = within(list).getAllByRole('listitem')
    expect(rows.length).toBeGreaterThan(0)
    rows.forEach((row) => {
      expect(row).toHaveClass('is-unread')
      expect(within(row).getByText('처리 대기')).toBeInTheDocument()
    })
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

    /*
      누른 알림은 읽음 처리되므로 `읽지 않음` 탭에서 빠진다. `읽음` 탭으로 넘어가면 처리 축이
      만료로 내려간 것을 확인할 수 있다 — 다시 눌러도 이동하지 않는 상태로 남는다.
    */
    await user.click(screen.getByRole('tab', { name: '읽음' }))
    const readList = await screen.findByRole('list', { name: '알림 목록' })
    const expiredRow = within(readList).getByRole('button', { name: /삭제된 보충 강의/ })
    expect(expiredRow).toHaveTextContent('만료됨')
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

    // 모두 읽음은 지금 보고 있는 축(읽지 않음)을 비운다 — 버튼이 그 줄에 있는 이유다.
    await user.click(screen.getByRole('button', { name: '모두 읽음' }))
    expect(await screen.findByText('읽지 않은 알림이 없습니다.')).toBeInTheDocument()

    // 사라진 것이 아니라 `읽음`으로 넘어갔을 뿐이다.
    await user.click(screen.getByRole('tab', { name: '읽음' }))
    const readList = await screen.findByRole('list', { name: '알림 목록' })
    expect(within(readList).getAllByRole('listitem').length).toBeGreaterThan(0)
  })
})
