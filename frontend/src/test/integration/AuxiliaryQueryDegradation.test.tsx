import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { ApiError } from '@/shared/api/client'
import { mockAuthService, resetMockAuth } from '@/features/auth/mockAuthService'
import * as myCurriculumsService from '@/features/curriculum/myCurriculumsService'
import * as liveSessionService from '@/features/live-session/liveSessionService'
import * as replayService from '@/features/replay/replayService'

// vidstack/hls.js는 jsdom에서 재생 경로를 세울 수 없다. 이 파일이 확인하는 것은 재생 자체가 아니라
// "부가 조회가 실패해도 화면이 열리는가"이므로 플레이어는 영역만 남기고 대체한다.
vi.mock('@/features/live-session/PlaybackPlayer', () => ({
  default: () => <div aria-label="강의 영상" role="region" />,
}))

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

/**
 * 수강생 강의실은 입장 전 점검을 통과했다는 navigation state가 있어야 열린다
 * (RequireStudentPrejoinRoute). BrowserRouter는 그 값을 history state의 `usr`에서 읽으므로,
 * 점검 화면을 전부 클릭해 통과하는 대신 같은 자리에 심어 강의실부터 연다.
 */
function renderAfterPrejoin(sessionId: string) {
  const path = `/student/live-sessions/${sessionId}/classroom`
  window.history.pushState({ usr: { prejoinSessionId: sessionId } }, '', path)
  return render(<App />)
}

function notReady() {
  return Promise.reject(new ApiError('아직 준비 중인 기능입니다.', 501, 'API_NOT_IMPLEMENTED'))
}

/**
 * 앱 QueryClient는 `retry: 1`이라 실패가 화면에 닿기까지 재시도 백오프만큼 걸린다. 그 백오프는
 * 실제로 흐르는 시간이라 부하가 걸린 러너에서는 더 늘어난다.
 *
 * <p>이 값은 기본 대기가 1초이던 시절의 "넉넉히"였는데, 그 뒤 기본이 5초로 올라가면서 오히려
 * <b>기본보다 좁은</b> 한도가 됐다 — 늘려 둔 여유를 이 상수가 도로 깎고 있었다. 기본보다 넓게 둔다.
 */
const AFTER_RETRY = { timeout: 10_000 }

describe('부가 조회 실패 시 화면 유지', () => {
  beforeEach(() => {
    resetMockAuth()
    window.history.replaceState({}, '', '/')
  })

  // 이 파일은 테스트마다 서비스 함수를 vi.spyOn으로 실패시키는데, 원복이 없어 그 스텁이 다음
  // 테스트까지 살아남았다(500을 내도록 바꾼 getLiveSession이 계속 500을 내는 식). 순서를 섞으면
  // 바로 드러난다. 전역 restoreMocks는 모듈 목 구현까지 되돌려 못 쓰므로 여기서만 원복한다.
  afterEach(() => {
    vi.restoreAllMocks()
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

  it('자막 WS 구독이 실패해도 수강생 라이브 강의실은 열린다', async () => {
    // 자막은 REST가 아니라 WS 델타 스트림으로 구동한다(§3-4 / ADR-0043). 구독이 곧바로
    // 에러로 끝나도(연결 실패 흉내) 미디어·채팅이 살아 있는 강의실은 열려야 한다.
    const captions = vi.spyOn(liveSessionService, 'subscribeCaptions')
      .mockImplementation((_sessionId, _onEvent, onConnectionChange) => {
        onConnectionChange('error')
        return () => {}
      })
    await mockAuthService.login({ email: 'student01@example.com', password: 'password1' })

    renderAfterPrejoin('ses-security-live')

    expect(await screen.findByRole('region', { name: '강의 영상' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: '실시간 자막' })).toBeInTheDocument()
    expect(screen.queryByText('라이브 강의를 불러오지 못했습니다')).not.toBeInTheDocument()
    // 자막 구독을 실제로 탔는지 확인한다 — 안 그러면 이 테스트는 헛통과한다.
    expect(captions).toHaveBeenCalled()
  })

  // 강사 화면에는 자막 독이 없다. 소비처가 없는데 WS를 열어 두면 송출 중인 브라우저에 쓰지 않을
  // 스트림 하나와 자막 리로드 요청이 계속 붙는다.
  it('강사 라이브 강의실은 자막을 구독하지도 리로드하지도 않는다', async () => {
    const captions = vi.spyOn(liveSessionService, 'subscribeCaptions')
    const reload = vi.spyOn(liveSessionService, 'getCaptions')
    await mockAuthService.login({ email: 'instructor@liveclass.ai', password: 'password1' })

    renderAt('/instructor/live-sessions/ses-security-live/classroom')

    expect(await screen.findByRole('heading', { name: 'Spring Security 시작하기', level: 1 })).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: '실시간 자막' })).not.toBeInTheDocument()
    expect(captions).not.toHaveBeenCalled()
    expect(reload).not.toHaveBeenCalled()
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
