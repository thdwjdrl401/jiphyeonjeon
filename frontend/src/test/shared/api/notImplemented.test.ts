import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, apiClient } from '@/shared/api/client'
import { isNotImplemented, notImplemented } from '@/shared/api/notImplemented'

vi.mock('@/shared/config/runtime', () => ({ isMockApiEnabled: false, isTestMode: false }))

import { httpLiveSessionService } from '@/features/live-session/httpLiveSessionService'
import { httpReplayService } from '@/features/replay/httpReplayService'
import { httpLessonService } from '@/features/lesson/httpLessonService'
import type { LiveSessionService } from '@/features/live-session/liveSessionService.interface'
import type { ReplayService } from '@/features/replay/replayService.interface'
import type { LessonService } from '@/features/lesson/lessonService.interface'

// 미구현 구현체는 쓰지 않는 인자를 받지 않으므로, 호출은 계약 타입으로 한다 —
// 화면이 부르는 방식(전체 인자)이 그대로 통하는지까지 함께 확인하는 셈이다.
const live: LiveSessionService = httpLiveSessionService
const replay: ReplayService = httpReplayService
const lesson: LessonService = httpLessonService

/**
 * 서버에 아직 없는 경로를 부르던 자리가 "미구현"으로 드러나는지 본다.
 *
 * 예전에는 없는 경로를 그냥 호출해 404가 났고, 화면에서는 그게 서버 장애와 구분되지 않았다.
 * 여기서 지키려는 것은 두 가지다 — (1) 네트워크로 나가지 않는다, (2) 화면이 분기할 수 있는
 * 안정적인 code가 실린다.
 */
describe('미구현 API 표시', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('501과 안정적인 code를 실어 던지고, 어느 경로인지 메시지에 남긴다', () => {
    try {
      notImplemented('GET /lessons/les-1/captions')
      expect.unreachable('던져야 한다')
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      expect(error).toMatchObject({ status: 501, code: 'API_NOT_IMPLEMENTED' })
      expect((error as ApiError).message).toContain('GET /lessons/les-1/captions')
    }
  })

  it('isNotImplemented는 미구현만 참이고 실제 서버 오류는 거짓이다', () => {
    const notReady = new ApiError('...', 501, 'API_NOT_IMPLEMENTED')
    const serverDown = new ApiError('...', 500, 'INTERNAL_ERROR')

    // 화면은 이 구분으로 "준비 중" 안내와 "오류" 안내를 고른다.
    expect(isNotImplemented(notReady)).toBe(true)
    expect(isNotImplemented(serverDown)).toBe(false)
    expect(isNotImplemented(new Error('네트워크'))).toBe(false)
  })

  // 서버에 경로가 생기면 이 목록에서 한 줄씩 빠진다.
  const unimplemented: Array<[string, () => Promise<unknown>]> = [
    // 라이브 자막 리로드(GET /live-sessions/{id}/captions)는 서버에 구현됨(CAPTION-01, ADR-0045) — 제외.
    // 라이브 AI 질문(POST /live-sessions/{id}/ai/answers/stream)도 구현됨(AI-QUESTION-01, ADR-0047) — 제외.
    // 다시보기 AI 질문(POST /lessons/{id}/ai/answers/stream)도 구현됨(ADR-0075) — 제외.
    // 녹화 처리 현황(GET /instructor/live-sessions/{id}/processing)도 구현됨(ADR-0059) — 제외.
    ['질문 하이라이트', () => live.getQuestionHighlights('ses-1')],
    // 다시보기 자막·채팅은 세션 단위 조회를 그대로 쓴다(구현됨) — 다시보기 전용 경로는 없앴다.
    ['검수 저장', () => replay.saveReplayReview('les-1', '자막')],
    ['퀴즈 제출', () => replay.submitReplayQuiz('les-1', '답')],
    // 학생 학습 요약(GET /me/learning-summary)·강사 대시보드 요약(GET /instructor/dashboard-summary)은
    // 모두 서버에 구현됨 — 여기서 제외.
    ['레슨 AI 준비', () => lesson.prepareLessonAi('les-1')],
  ]

  it.each(unimplemented)('%s은 네트워크로 나가지 않고 501로 끝난다', async (_label, call) => {
    const get = vi.spyOn(apiClient, 'get')
    const post = vi.spyOn(apiClient, 'post')
    const put = vi.spyOn(apiClient, 'put')

    await expect(call()).rejects.toMatchObject({ status: 501, code: 'API_NOT_IMPLEMENTED' })
    expect(get).not.toHaveBeenCalled()
    expect(post).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
  })

  it('구현된 기존 자산 수동 게시 API는 실제 endpoint를 호출한다', async () => {
    const post = vi.spyOn(apiClient, 'post').mockResolvedValue({ data: undefined } as never)

    await expect(replay.publishReplayReview('les-1')).resolves.toBeUndefined()
    expect(post).toHaveBeenCalledWith('/instructor/lessons/les-1/replay-review/publish')
  })
})
