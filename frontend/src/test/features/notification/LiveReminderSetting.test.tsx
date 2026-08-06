import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AuthProvider } from '@/features/auth/AuthContext'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import type { UserRole } from '@/features/auth/types'

const getNotificationLeadTimes = vi.fn()
const getNotificationPreference = vi.fn()
const saveNotificationPreference = vi.fn()
vi.mock('@/features/notification/notificationService', () => ({
  getNotificationLeadTimes: () => getNotificationLeadTimes(),
  getNotificationPreference: (c: string, l?: string) => getNotificationPreference(c, l),
  saveNotificationPreference: (i: unknown) => saveNotificationPreference(i),
}))

import { LiveReminderSetting } from '@/features/notification/LiveReminderSetting'

/**
 * 라이브 곧 시작 알림 설정.
 *
 * <p>지키려는 것은 넷이다 — <b>안내 문구가 읽는 사람의 역할에 맞는가</b>, <b>수강생에게 이 설정이
 * 다른 알림과 무관하다는 것을 밝히는가</b>, <b>값이 어디서 왔는지 알려 주는가</b>, <b>1440분을
 * 사람이 읽는 단위로 보여 주는가</b>.
 *
 * <p>강의 팝오버에서는 값이 이 강의만의 설정인지 커리큘럼·기본값에서 내려온 것인지 구별해야 한다.
 */
describe('라이브 시작 알림 설정', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    resetMockAuth()
    getNotificationLeadTimes.mockResolvedValue({ choices: [5, 10, 30, 60, 180, 1440], defaultMinutes: 10 })
  })

  async function renderSetting(props: { curriculumId: string; lessonId?: string }, role: UserRole = 'STUDENT') {
    await mockAuthService.login({
      email: role === 'INSTRUCTOR' ? 'instructor@liveclass.ai' : 'student@liveclass.ai',
      password: 'password1',
    })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(
      <QueryClientProvider client={client}>
        <AuthProvider>
          <LiveReminderSetting {...props} />
        </AuthProvider>
      </QueryClientProvider>,
    )
  }

  it('미설정 기본값은 알림 켜짐과 10분 전이고 다른 알림과 무관함을 밝힌다', async () => {
    getNotificationPreference.mockResolvedValue({ enabled: true, leadMinutes: 10, source: 'DEFAULT' })

    await renderSetting({ curriculumId: 'cur_1' })

    expect(await screen.findByText(/다른 알림은 이 설정과/)).toBeInTheDocument()
    expect(screen.getByRole('checkbox', { name: '미리 알림 받기' })).toBeChecked()
    expect(screen.getByRole('combobox')).toHaveValue('10')
  })

  /**
   * 강사에게 "수강 승인·자료 등록 알림은 그대로 옵니다"라고 말하면, 자기가 받지도 않는 알림을
   * 안내받는 셈이다. 강사가 이 설정을 켜는 이유는 방송 준비 시간을 확보하는 것이다.
   */
  it('강사에게는 방송 준비 관점의 안내를 보여 준다', async () => {
    getNotificationPreference.mockResolvedValue({ enabled: true, leadMinutes: 10, source: 'DEFAULT' })

    await renderSetting({ curriculumId: 'cur_1' }, 'INSTRUCTOR')

    expect(await screen.findByText(/방송 준비를 놓치지 않도록/)).toBeInTheDocument()
    expect(screen.queryByText(/수강 승인·자료 등록/)).not.toBeInTheDocument()
  })

  /** 1440분을 "1440분"이라고 보여 주지 않는다. */
  it('리드타임을 사람이 읽는 단위로 보여 준다', async () => {
    getNotificationPreference.mockResolvedValue({ enabled: true, leadMinutes: 10, source: 'DEFAULT' })

    await renderSetting({ curriculumId: 'cur_1' })

    expect(await screen.findByRole('option', { name: '1일 전' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '3시간 전' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: '5분 전' })).toBeInTheDocument()
  })

  it('강의 설정이 커리큘럼에서 내려온 것인지 알려 준다', async () => {
    getNotificationPreference.mockResolvedValue({ enabled: true, leadMinutes: 30, source: 'CURRICULUM' })

    await renderSetting({ curriculumId: 'cur_1', lessonId: 'les_1' })

    expect(await screen.findByText(/커리큘럼 설정을 따르고 있습니다/)).toBeInTheDocument()
  })

  it('강의 설정이 기본값에서 내려온 것인지 알려 준다', async () => {
    getNotificationPreference.mockResolvedValue({ enabled: true, leadMinutes: 10, source: 'DEFAULT' })

    await renderSetting({ curriculumId: 'cur_1', lessonId: 'les_1' })

    expect(await screen.findByText(/기본 설정을 따르고 있습니다/)).toBeInTheDocument()
  })

  it('이 강의만 다르게 설정된 경우를 구별해 알려 준다', async () => {
    getNotificationPreference.mockResolvedValue({ enabled: true, leadMinutes: 5, source: 'LESSON' })

    await renderSetting({ curriculumId: 'cur_1', lessonId: 'les_1' })

    expect(await screen.findByText(/이 강의만 다르게 설정되어 있습니다/)).toBeInTheDocument()
  })

  it('리드타임을 고르면 강의 범위로 저장한다', async () => {
    getNotificationPreference.mockResolvedValue({ enabled: true, leadMinutes: 10, source: 'CURRICULUM' })
    saveNotificationPreference.mockResolvedValue(undefined)
    await renderSetting({ curriculumId: 'cur_1', lessonId: 'les_1' })
    const select = await screen.findByRole('combobox')

    await userEvent.selectOptions(select, '30')

    await waitFor(() =>
      expect(saveNotificationPreference).toHaveBeenCalledWith({
        curriculumId: 'cur_1',
        lessonId: 'les_1',
        enabled: true,
        leadMinutes: 30,
      }),
    )
  })

  /** 꺼 두면 리드타임을 고를 이유가 없다 — 고를 수 있게 두면 무엇이 적용되는지 헷갈린다. */
  it('꺼 두면 리드타임 선택을 막는다', async () => {
    getNotificationPreference.mockResolvedValue({ enabled: false, leadMinutes: 10, source: 'CURRICULUM' })

    await renderSetting({ curriculumId: 'cur_1' })

    expect(await screen.findByRole('combobox')).toBeDisabled()
  })
})
