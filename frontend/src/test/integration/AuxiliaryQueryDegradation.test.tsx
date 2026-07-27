import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { ApiError } from '@/shared/api/client'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import * as myCurriculumsService from '@/features/curriculum/myCurriculumsService'
import * as liveSessionService from '@/features/live-session/liveSessionService'
import * as replayService from '@/features/replay/replayService'

/**
 * 부가 데이터가 실패해도 화면은 열려야 한다.
 *
 * 학습 요약·자막처럼 아직 서버 경로가 없는 조회가 진입 게이트에 섞여 있었다.
 * 그래서 목록이나 세션을 정상으로 불러왔는데도 페이지 전체가 오류 화면으로 막혔다.
 * 여기서 지키는 것은 "필수가 성공하면 화면은 뜬다"는 성질이다.
 */
function renderAt(path: string) {
  window.history.pushState({}, '', path)
  return render(<App />)
}

function notReady() {
  return Promise.reject(new ApiError('아직 준비 중인 기능입니다.', 501, 'API_NOT_IMPLEMENTED'))
}

/**
 * 앱 QueryClient는 `retry: 1`이라 실패가 화면에 닿기까지 재시도 백오프만큼 걸린다.
 * findBy 기본 대기(1초)로는 모자라므로 오류 상태를 기다릴 때만 넉넉히 준다.
 */
const AFTER_RETRY = { timeout: 3_000 }

describe('부가 조회 실패 시 화면 유지', () => {
  beforeEach(() => {
    resetMockAuth()
    window.history.replaceState({}, '', '/')
  })

  it('학습 요약이 실패해도 커리큘럼 목록은 뜨고, 준비 중임을 알린다', async () => {
    vi.spyOn(myCurriculumsService, 'getInstructorDashboardSummary').mockImplementation(notReady)
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })

    renderAt('/instructor/curriculums')

    expect(await screen.findByRole('heading', { name: '내 커리큘럼', level: 1 })).toBeInTheDocument()
    expect(await screen.findByText(/학습 요약은 아직 준비 중입니다/, undefined, AFTER_RETRY)).toBeInTheDocument()
    // 목록은 멀쩡하다 — 요약 하나 때문에 목록까지 막히면 안 된다.
    expect(await screen.findByText('라이브로 완성하는 Spring Boot')).toBeInTheDocument()
    expect(screen.queryByText(/커리큘럼 목록을 불러오지 못했습니다/)).not.toBeInTheDocument()
  })

  it('목록 자체가 실패하면 목록 오류를 알린다', async () => {
    vi.spyOn(myCurriculumsService, 'getInstructorCurriculums')
      .mockImplementation(() => Promise.reject(new ApiError('서버 오류', 500, 'INTERNAL_ERROR')))
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })

    renderAt('/instructor/curriculums')

    expect(await screen.findByText(/커리큘럼 목록을 불러오지 못했습니다/, undefined, AFTER_RETRY)).toBeInTheDocument()
  })

  it('자막이 실패해도 라이브 강의실은 열린다', async () => {
    const captions = vi.spyOn(liveSessionService, 'getCaptions').mockImplementation(notReady)
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })

    renderAt('/instructor/live-sessions/ses-security-live/classroom')

    expect(await screen.findByRole('heading', { name: 'Spring Security 시작하기', level: 1 })).toBeInTheDocument()
    expect(screen.queryByText('라이브 강의를 불러오지 못했습니다')).not.toBeInTheDocument()
    // 실패한 조회를 실제로 탔는지 확인한다 — 안 그러면 이 테스트는 헛통과한다.
    expect(captions).toHaveBeenCalled()
  })

  it('세션 조회가 실패하면 라이브 강의실은 오류 화면을 낸다', async () => {
    vi.spyOn(liveSessionService, 'getLiveSession')
      .mockImplementation(() => Promise.reject(new ApiError('서버 오류', 500, 'INTERNAL_ERROR')))
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })

    renderAt('/instructor/live-sessions/ses-security-live/classroom')

    // PageState는 heading이 아니라 <strong>으로 그린다 — role로 찾으면 늘 못 찾아 헛통과한다.
    expect(await screen.findByText('라이브 강의를 불러오지 못했습니다', undefined, AFTER_RETRY))
      .toBeInTheDocument()
  })

  it('게시본 자막·채팅이 실패해도 다시보기는 열린다', async () => {
    const captions = vi.spyOn(replayService, 'getReplayCaptions').mockImplementation(notReady)
    vi.spyOn(replayService, 'getReplayMessages').mockImplementation(notReady)
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })

    renderAt('/instructor/lessons/les-security/replay')

    expect(await screen.findByRole('heading', { name: 'Spring Security 시작하기', level: 1 })).toBeInTheDocument()
    expect(screen.queryByText('다시보기를 불러오지 못했습니다')).not.toBeInTheDocument()
    expect(captions).toHaveBeenCalled()
  })
})
