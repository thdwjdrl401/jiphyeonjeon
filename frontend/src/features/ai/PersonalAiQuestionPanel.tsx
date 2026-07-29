import { useCallback, useEffect, useReducer, useRef, useState, type FormEvent } from 'react'
import yeongsilImage from '@/assets/yeongsil.png'
import type { AiAnswerStreamOptions } from '@/features/live-session/liveSessionService'
import { InlineNotice } from '@/shared/ui/WorkspaceUi'
import AiEvidenceList from './AiEvidenceList'
import { emptyAiAnswerState, reduceAiAnswer } from './aiAnswer'

export type AskAiAnswer = (question: string, options: AiAnswerStreamOptions) => Promise<void>

interface PersonalAiQuestionPanelProps {
  /**
   * 질문 한 건을 보내고 SSE 이벤트를 흘리는 함수. **없으면 미지원 모드**로 그린다 —
   * 다시보기 AI가 그 경우다(ai-api가 sessionId 필수 + 시간 축이 달라 아직 열 수 없다, ADR-0047 §9).
   */
  ask?: AskAiAnswer
  /** 미지원 모드에서 왜 쓸 수 없는지. `ask`가 없을 때만 쓰인다. */
  unavailableNotice?: string
  placeholder?: string
  /** 빈 상태에서 무엇을 근거로 답하는지 안내. */
  emptyDescription?: string
}

const DEFAULT_UNAVAILABLE_NOTICE = '이 화면에서는 AI 질문을 아직 지원하지 않습니다.'

/**
 * 개인 AI 질의응답 패널(AI-QUESTION-01, `docs/frontend/components/LIVE_LESSON.md` §4.3).
 *
 * 라이브·다시보기 사이드바가 같은 컴포넌트를 쓴다. 답변은 단발 응답이 아니라 SSE 스트림이라
 * 델타를 누적해 그리고, terminal 종류에 따라 근거·근거 없음·오류로 갈린다. 실패해도 영상·채팅은
 * 그대로 두고 이 패널 안에서만 재시도한다(LIVE_LESSON.md §10.3 "AI Q&A 실패").
 */
export default function PersonalAiQuestionPanel({
  ask,
  unavailableNotice,
  placeholder = '이 강의에서 궁금한 점을 질문하세요.',
  emptyDescription = '강의 자료와 현재까지의 발화를 근거로 답변합니다.',
}: PersonalAiQuestionPanelProps) {
  const [answer, dispatch] = useReducer(reduceAiAnswer, emptyAiAnswerState)
  const [question, setQuestion] = useState('')
  // 진행 중인 요청의 중단 핸들. 새 질문·취소·언마운트가 모두 같은 핸들을 끊는다.
  const requestRef = useRef<AbortController | null>(null)
  const isAvailable = Boolean(ask)
  const isStreaming = answer.status === 'streaming'

  useEffect(() => () => requestRef.current?.abort(), [])

  const run = useCallback(async (asked: string) => {
    if (!ask) return
    // 앞선 요청을 먼저 끊는다 — 서버가 그 신호로 ai-api 연결까지 정리한다(ADR-0047 §6).
    requestRef.current?.abort()
    const request = new AbortController()
    requestRef.current = request
    dispatch({ kind: 'ask', question: asked })
    try {
      await ask(asked, { onEvent: (event) => dispatch({ kind: 'event', event }), signal: request.signal })
      if (!request.signal.aborted) dispatch({ kind: 'ended' })
    } catch (error) {
      if (!request.signal.aborted) dispatch({ kind: 'failed', error })
    }
  }, [ask])

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault()
    // 서버가 trim하지 않으므로 여기서 다듬어 보낸다(LIVE.md §10.1).
    const asked = question.trim()
    if (!asked || isStreaming) return
    void run(asked)
  }

  const cancel = () => {
    requestRef.current?.abort()
    dispatch({ kind: 'cancelled' })
  }

  return (
    <>
      {answer.status === 'idle' && (
        <div className="ai-empty">
          <img className="ai-empty__avatar" src={yeongsilImage} alt="AI 질문 도우미 영실" />
          <h3>한 번 아뢰어 보거라</h3>
          <p>{isAvailable ? emptyDescription : (unavailableNotice ?? DEFAULT_UNAVAILABLE_NOTICE)}</p>
        </div>
      )}

      {!isAvailable && (
        <InlineNotice tone="warning">{unavailableNotice ?? DEFAULT_UNAVAILABLE_NOTICE}</InlineNotice>
      )}

      {answer.status !== 'idle' && (
        <div className="ai-answer">
          <strong>답변</strong>
          {/* 스트리밍 중에는 스크린리더가 조각마다 읽지 않도록 polite로 두고, 끝난 뒤 전문이 남는다. */}
          <p aria-live="polite" aria-busy={isStreaming}>{answer.text}</p>
          {isStreaming && <small className="ai-answer__pending">답변을 작성하고 있습니다…</small>}
          {answer.status !== 'streaming' && answer.notice && (
            <p role={answer.status === 'error' ? 'alert' : undefined}>{answer.notice}</p>
          )}
          <AiEvidenceList sources={answer.sources} />
          <div className="ai-answer__actions">
            {isStreaming && (
              <button className="button button--ghost button--small" type="button" onClick={cancel}>답변 중단</button>
            )}
            {answer.status === 'error' && answer.retryable && (
              <button
                className="button button--soft button--small"
                type="button"
                onClick={() => void run(answer.question)}
              >
                다시 시도
              </button>
            )}
          </div>
        </div>
      )}

      <form onSubmit={submitQuestion}>
        <label className="visually-hidden" htmlFor="ai-question-input">AI에게 할 질문</label>
        <textarea
          id="ai-question-input"
          rows={3}
          value={question}
          placeholder={placeholder}
          disabled={!isAvailable}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button
          className="button button--primary button--full"
          type="submit"
          disabled={!isAvailable || isStreaming || question.trim().length === 0}
        >
          {isStreaming ? '답변을 기다리는 중' : '질문하기'}
        </button>
      </form>
    </>
  )
}
