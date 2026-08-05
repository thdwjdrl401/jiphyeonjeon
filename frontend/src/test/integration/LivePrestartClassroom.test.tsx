import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import { resetMockDatabase } from '@/features/demo/mockDatabase'
import {
  mockLiveSessionService,
  resetMockLiveSessions,
} from '@/features/live-session/mockLiveSessionService'

/**
 * 플레이어는 목으로 바꾼다. 여기서 보려는 것은 <b>재생이 되는지</b>가 아니라 시작 전후에 어느 자리에
 * 무엇이 그려지는지다 — 실제 vidstack을 띄우면 HLS를 물지 못해 그 자체로 오류가 난다.
 */
vi.mock('@/features/live-session/PlaybackPlayer', () => ({
  default: () => <div aria-label="강의 영상" role="region">플레이어</div>,
}))

const SESSION_ID = 'ses-security-live'
const CLASSROOM = `/student/live-sessions/${SESSION_ID}/classroom`

function enterClassroom() {
  // 수강생은 입장 전 점검을 거쳐야 강의실에 들어간다(RequireStudentPrejoinRoute).
  window.history.pushState({ usr: { prejoinSessionId: SESSION_ID } }, '', CLASSROOM)
  return render(<App />)
}

/** 녹화 안내 모달을 닫는다 — 확인하기 전에는 강의실 본문이 가려진다. */
async function acknowledgeRecording(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: '확인하고 참여하기' }))
}

/**
 * 강사가 아직 시작하지 않은 강의실.
 *
 * <p>입장창은 <b>시계가 연다</b>(예정 시각 −N분) — 강사가 여는 것이 아니다. 그래서 시작 전에도 강의실에
 * 사람이 있는데, 예전에는 그 상태에 이름이 없었다: 재생 조회가 실패해 "시청할 수 있는 영상이 없습니다"라는
 * <b>오류</b>가 뜨고, 채팅 입력창은 이유도 없이 사라졌다.
 *
 * <p>여기서 못박는 것은 두 가지다 — (1) 잠긴 자리마다 왜 잠겼는지가 보인다, (2) 강사가 시작하면
 * <b>새로고침 없이</b> 재생 화면으로 넘어간다.
 */
describe('시작 전 강의실', () => {
  beforeEach(() => {
    resetMockAuth()
    resetMockDatabase()
    resetMockLiveSessions()
    window.localStorage.clear()
    window.history.replaceState({}, '', '/')
  })

  it('시작 전에는 영상 자리에 오류 대신 기다림을 그린다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    enterClassroom()
    await acknowledgeRecording(user)

    /*
     * <b>영상 자리 안에서</b> 확인한다. 같은 문구가 채팅·AI 쪽에도 있는데(잠긴 자리마다 이유를 적는다),
     * 화면 어딘가에 있다는 것만 보면 정작 영상 자리는 비어 있어도 통과한다.
     */
    const stage = await screen.findByRole('region', { name: '강의 영상' })
    expect(within(stage).getByText('아직 강의가 시작되지 않았습니다.')).toBeInTheDocument()
    expect(within(stage).getByText(/새로고침하지 않아도 됩니다/)).toBeInTheDocument()
    // 재생 조회 실패 문구가 이 자리에 오면 안 된다 — 기다림은 고장이 아니다.
    expect(screen.queryByText('시청할 수 있는 영상이 없습니다.')).not.toBeInTheDocument()
    expect(screen.queryByText('플레이어')).not.toBeInTheDocument()
  })

  it('채팅 입력창은 사라지지 않고 잠긴 채로 이유를 보여준다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    enterClassroom()
    await acknowledgeRecording(user)

    /*
     * <b>존재하되 잠겨 있어야</b> 한다. 통째로 사라지면 채팅이 원래 없는 화면인지 지금만 막힌 것인지
     * 구별할 수 없다 — 예전 동작이 그랬다.
     */
    const composer = await screen.findByRole('textbox', { name: '채팅 메시지' })
    expect(composer).toBeDisabled()
    expect(screen.getByRole('button', { name: '전송' })).toBeDisabled()

    // 이유는 <b>그 입력창 옆에</b> 있어야 한다 — 영상 자리에만 적혀 있으면 탭을 보는 사람은 못 읽는다.
    const panel = composer.closest('.discussion-panel')
    expect(panel).not.toBeNull()
    expect(within(panel as HTMLElement).getByText(/강사가 강의를 시작하면 자동으로 재생됩니다/))
      .toBeInTheDocument()
  })

  it('AI 질문도 같은 이유로 잠긴다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    enterClassroom()
    await acknowledgeRecording(user)
    await user.click(await screen.findByRole('tab', { name: 'AI 질문' }))

    expect(await screen.findByRole('textbox', { name: 'AI에게 할 질문' })).toBeDisabled()
    /*
     * 기본 문구("이 화면에서는 AI 질문을 아직 지원하지 않습니다")가 나가면 안 된다 — 지원하지 않는
     * 것과 아직 시작하지 않은 것은 다르다. 앞은 기다려도 소용없고 뒤는 기다리면 된다.
     */
    expect(screen.queryByText(/아직 지원하지 않습니다/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/강사가 강의를 시작하면 자동으로 재생됩니다/).length).toBeGreaterThan(0)
  })

  it('강사가 시작하면 새로고침 없이 재생 화면으로 넘어간다', async () => {
    const user = userEvent.setup()
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })
    enterClassroom()
    await acknowledgeRecording(user)
    await screen.findByText('아직 강의가 시작되지 않았습니다.')

    /*
     * 강사의 시작을 흉내 낸다. 목은 서버와 같은 순서로 상태 토픽에 `session.starting`·`session.started`를
     * 흘린다 — 이 화면이 시작을 알아채는 <b>유일한 신호</b>다.
     */
    await mockLiveSessionService.startLiveSession(SESSION_ID)
    expect(await screen.findByText('강의를 시작하고 있습니다.')).toBeInTheDocument()

    await mockLiveSessionService.getLiveStartStatus(SESSION_ID)
    await waitFor(() => expect(screen.getByText('플레이어')).toBeInTheDocument())
    // 잠금이 함께 풀린다 — 화면만 바뀌고 입력이 잠긴 채로 남으면 시작한 것이 아니다.
    await waitFor(() => expect(screen.getByRole('textbox', { name: '채팅 메시지' })).toBeEnabled())
  })
})
