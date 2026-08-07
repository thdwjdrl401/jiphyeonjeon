import type {
  AiAnswerSource,
  AiAnswerStreamEvent,
  AiAnswerStreamOptions,
} from '@/features/live-session/liveSessionService.interface'
import { ApiError, invalidateCsrfToken, resolveCsrfHeader } from '@/shared/api/client'
import { createSseDecoder, type SseFrame } from '@/shared/api/sse'
import { isNetworkBlocked } from '@/shared/config/runtime'

/**
 * 레슨 AI 질문(Replay v2) 스트림 한 건.
 *
 * <p>업로드 녹화강의와 라이브 다시보기가 **같은 endpoint**를 쓰므로(ADR-0075) 읽는 코드도 하나다.
 * 예전에는 이 SSE 리더가 녹화강의 서비스에 한 벌, 라이브 서비스에 또 한 벌 복사돼 있었다.
 *
 * `EventSource`는 GET만 지원하는데 이건 POST라 fetch + ReadableStream으로 직접 읽는다. 쿠키 세션이라
 * `credentials: 'include'`, 상태변경이라 CSRF 헤더가 필요하다(ADR-0014) — axios 인터셉터를 타지 않아
 * 직접 붙인다.
 *
 * 경로가 `/stream`으로 끝나는 것은 계약이다. 운영 nginx는 `location ~ ^/api/.+/stream$`에만
 * `proxy_buffering off`를 적용해서, 다른 접미사면 토큰이 뭉쳐 스트리밍이 깨진다(운영에서만 드러난다).
 */
export async function streamLessonAiAnswer(
  lessonId: string,
  question: string,
  playbackMs: number,
  { onEvent, signal }: AiAnswerStreamOptions,
) {
  if (isNetworkBlocked) {
    throw new ApiError(
      '테스트에서는 실제 네트워크 요청을 보낼 수 없습니다.',
      undefined,
      'MOCK_API_NETWORK_REQUEST_BLOCKED',
    )
  }

  let response: Response
  try {
    response = await fetch(`/api/lessons/${lessonId}/ai/answers/stream`, {
      method: 'POST',
      credentials: 'include',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
        ...(await resolveCsrfHeader()),
      },
      // 서버가 채우는 값(자산·커리큘럼·세션 ID, 자막 문맥, requestId)은 보내지 않는다 — 클라 값을
      // 신뢰하면 수강하지 않은 강의의 근거를 열람할 수 있다.
      body: JSON.stringify({ question, playbackMs }),
    })
  } catch (error) {
    if (isAbort(error, signal)) return
    throw new ApiError('AI 답변 요청을 보내지 못했습니다.', undefined, 'AI_ANSWER_NETWORK_FAILED')
  }

  if (!response.ok) throw await toStreamStartError(response)
  if (!response.body) {
    throw new ApiError('AI 답변 스트림을 읽을 수 없습니다.', response.status, 'AI_ANSWER_STREAM_UNREADABLE')
  }

  const decoder = createSseDecoder()
  const text = new TextDecoder()
  const reader = response.body.getReader()
  const emit = (frames: SseFrame[]) => {
    for (const frame of frames) {
      const event = toLessonAiEvent(frame)
      if (event) onEvent(event)
    }
  }

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      emit(decoder.push(text.decode(value, { stream: true })))
    }
    // 스트림이 개행 없이 끝나도 마지막 프레임을 흘리지 않는다.
    emit(decoder.flush())
  } catch (error) {
    // 취소는 사용자가 방금 한 행동이다 — 오류로 올리면 화면이 재시도 버튼을 띄운다.
    if (isAbort(error, signal)) return
    throw new ApiError('AI 답변 스트림이 끊겼습니다.', undefined, 'AI_ANSWER_STREAM_FAILED')
  } finally {
    // 중단됐다면 남은 바디를 버려 서버 쪽 릴레이(=ai-api 연결)까지 정리되게 한다.
    void reader.cancel().catch(() => undefined)
  }
}

const AI_ANSWER_EVENT_TYPES = new Set(['answer.delta', 'answer.done', 'answer.insufficient', 'answer.error'])

function readExcerpt(raw: unknown): string | undefined {
  const text = typeof raw === 'string' ? raw.trim() : ''
  return text.length > 0 ? text : undefined
}

/**
 * Replay v2의 session-ms 근거를 기존 AI 카드 모델의 `startMs`/`endMs`로 옮긴다.
 *
 * `timeAxis: 'PLAYBACK'`이 핵심이다 — 이 좌표는 플레이어와 같은 축이라 눌러서 이동할 수 있다는 표시다
 * (라이브 v1 근거는 STT attempt-local 축이라 이동을 주지 않는다).
 */
function normalizeReplaySources(raw: unknown): AiAnswerSource[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((item): AiAnswerSource[] => {
    const source = item as Record<string, unknown>
    if (source?.type === 'PPTX') {
      return [{
        type: 'PPTX',
        materialId: String(source.materialId ?? ''),
        page: Number(source.page ?? 0),
        excerpt: readExcerpt(source.excerpt),
      }]
    }
    if (source?.type === 'CAPTION') {
      const sessionId = String(source.sessionId ?? '')
      return [{
        type: 'CAPTION',
        sessionId,
        // v2는 sttSessionId를 주지 않는다(계약). 카드 key용으로만 만들어 쓴다.
        sttSessionId: `replay:${sessionId}`,
        startMs: Number(source.startSessionMs ?? 0),
        endMs: Number(source.endSessionMs ?? 0),
        excerpt: readExcerpt(source.excerpt),
        timeAxis: 'PLAYBACK',
      }]
    }
    if (source?.type === 'ANNOTATION') {
      return [{
        type: 'ANNOTATION',
        highlightId: String(source.highlightId ?? ''),
        sessionId: String(source.sessionId ?? ''),
        sessionMs: Number(source.sessionMs ?? 0),
        excerpt: readExcerpt(source.excerpt),
        // v2 판서 근거의 sessionMs는 플레이어와 같은 다시보기 축이다(ADR-0043 §6).
        timeAxis: 'PLAYBACK',
      }]
    }
    return []
  })
}

function toLessonAiEvent(frame: SseFrame): AiAnswerStreamEvent | null {
  if (!AI_ANSWER_EVENT_TYPES.has(frame.event)) return null
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(frame.data) as Record<string, unknown>
  } catch {
    return null
  }
  const requestId = String(payload.requestId ?? '')
  switch (frame.event) {
    case 'answer.delta':
      return { type: 'answer.delta', payload: { requestId, text: String(payload.text ?? '') } }
    case 'answer.done':
      return { type: 'answer.done', payload: { requestId, sources: normalizeReplaySources(payload.sources) } }
    case 'answer.insufficient':
      return { type: 'answer.insufficient', payload: { requestId, message: String(payload.message ?? '') } }
    default:
      return {
        type: 'answer.error',
        payload: {
          requestId,
          code: String(payload.code ?? ''),
          message: String(payload.message ?? ''),
          retryable: payload.retryable === true,
        },
      }
  }
}

function isAbort(error: unknown, signal?: AbortSignal) {
  return signal?.aborted === true || (error instanceof Error && error.name === 'AbortError')
}

/** 스트림 시작 전 실패를 화면이 분기할 수 있는 `ApiError`로 옮긴다(axios 응답 인터셉터와 같은 모양). */
async function toStreamStartError(response: Response) {
  if (response.status === 401) invalidateCsrfToken()
  let payload: { code?: string; message?: string; correlationId?: string } = {}
  try {
    payload = (await response.json()) as typeof payload
  } catch {
    // 봉투가 없는 실패(프록시·게이트웨이)도 있다. 상태코드만으로 안내한다.
  }
  return new ApiError(
    payload.message ?? '요청을 처리하지 못했습니다.',
    response.status,
    payload.code,
    undefined,
    payload.correlationId,
  )
}
