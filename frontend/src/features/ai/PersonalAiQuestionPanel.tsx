import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import yeongsilImage from '@/assets/yeongsil.png'
import type { AiAnswerStreamOptions } from '@/features/live-session/liveSessionService'
import { InlineNotice } from '@/shared/ui/WorkspaceUi'
import AiChatTurn from './AiChatTurn'
import {
  emptyAiConversationState,
  reduceAiConversation,
  selectStreamingTurn,
  type AiConversationState,
} from './aiConversation'

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
const DEFAULT_PLACEHOLDER = '이 강의에서 궁금한 점을 질문하세요. (Enter 전송 · Shift+Enter 줄바꿈)'
/** 이력을 어디까지 들고 있는지 과장 없이 밝힌다 — 서버 저장이 아니다(AI-HISTORY-01 미구현). */
const MEMORY_ONLY_NOTE = '대화는 이 화면에서만 유지되며 새로고침하면 사라집니다.'
/** 하단에서 이만큼 안쪽이면 "읽는 중"으로 보고 강제로 끌어내리지 않는다(채팅 패널과 같은 값). */
const FOLLOW_THRESHOLD_PX = 48

/**
 * 개인 AI 질의응답 패널(AI-QUESTION-01, `docs/frontend/components/LIVE_LESSON.md` §4.3).
 *
 * 익숙한 챗 인터페이스로 그린다 — 질문은 보내는 즉시 말풍선으로 올라가고(입력창은 비워진다),
 * 그 아래 AI 턴이 생겨 델타가 도착하는 대로 자란다. 이전 턴은 지워지지 않고 이력으로 쌓인다.
 * 다만 이력은 **클라이언트 메모리뿐**이다 — 서버 이력 API가 없어(AI-HISTORY-01) 새로고침하면 사라지고,
 * 화면도 그 사실을 입력창 옆에서 밝힌다.
 *
 * 라이브·다시보기 사이드바가 같은 컴포넌트를 쓴다. 실패해도 영상·채팅은 그대로 두고 이 패널 안에서만
 * 재시도한다(LIVE_LESSON.md §10.3 "AI Q&A 실패").
 */
export default function PersonalAiQuestionPanel({
  ask,
  unavailableNotice,
  placeholder = DEFAULT_PLACEHOLDER,
  emptyDescription = '강의 자료와 현재까지의 발화를 근거로 답변합니다.',
}: PersonalAiQuestionPanelProps) {
  const [conversation, dispatch] = useReducer(reduceAiConversation, emptyAiConversationState)
  const [question, setQuestion] = useState('')
  // 진행 중인 요청의 중단 핸들. 새 질문·취소·언마운트가 모두 같은 핸들을 끊는다.
  const requestRef = useRef<AbortController | null>(null)
  const turnSequence = useRef(0)
  // 이벤트 핸들러가 최신 이력을 보되 콜백 정체성은 유지하도록 두는 거울. 턴 memo가 이것에 달려 있다.
  const conversationRef = useRef<AiConversationState>(conversation)
  const logRef = useRef<HTMLDivElement>(null)
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)

  const isAvailable = Boolean(ask)
  const streamingTurn = selectStreamingTurn(conversation)
  const isStreaming = streamingTurn !== null
  const hasTurns = conversation.turns.length > 0

  useEffect(() => { conversationRef.current = conversation }, [conversation])
  useEffect(() => () => requestRef.current?.abort(), [])

  // 새 턴·새 델타를 따라 하단으로 붙는다. 위로 올려 읽는 중이면(isFollowingLatest=false) 건드리지 않는다.
  useLayoutEffect(() => {
    if (!isFollowingLatest) return
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
  }, [conversation, isFollowingLatest])

  const handleLogScroll = () => {
    const log = logRef.current
    if (!log) return
    const distanceFromBottom = log.scrollHeight - log.scrollTop - log.clientHeight
    setIsFollowingLatest(distanceFromBottom <= FOLLOW_THRESHOLD_PX)
  }

  const scrollToLatest = () => {
    const log = logRef.current
    if (log) log.scrollTop = log.scrollHeight
    setIsFollowingLatest(true)
  }

  const stream = useCallback(async (turnId: string, asked: string) => {
    if (!ask) return
    // 앞선 요청을 먼저 끊는다 — 서버가 그 신호로 ai-api 연결까지 정리한다(ADR-0047 §6).
    requestRef.current?.abort()
    const request = new AbortController()
    requestRef.current = request
    try {
      await ask(asked, {
        onEvent: (event) => dispatch({ kind: 'turn', id: turnId, action: { kind: 'event', event } }),
        signal: request.signal,
      })
      if (!request.signal.aborted) dispatch({ kind: 'turn', id: turnId, action: { kind: 'ended' } })
    } catch (error) {
      if (!request.signal.aborted) dispatch({ kind: 'turn', id: turnId, action: { kind: 'failed', error } })
    }
  }, [ask])

  const submitQuestion = (event: FormEvent) => {
    event.preventDefault()
    // 서버가 trim하지 않으므로 여기서 다듬어 보낸다(LIVE.md §10.1).
    const asked = question.trim()
    if (!ask || !asked || isStreaming) return
    turnSequence.current += 1
    const turnId = `ai-turn-${turnSequence.current}`
    dispatch({ kind: 'ask', id: turnId, question: asked })
    // 낙관적 전송: 질문은 위 말풍선으로 갔으니 입력창은 즉시 비운다.
    setQuestion('')
    setIsFollowingLatest(true)
    void stream(turnId, asked)
  }

  /**
   * Enter 전송 / Shift+Enter 줄바꿈.
   *
   * `isComposing`을 먼저 본다 — 한글 IME는 조합을 확정할 때도 Enter를 쓰므로, 이 검사가 없으면
   * "안녕하세" 상태에서 조합 확정 Enter가 그대로 전송돼 버린다(채팅 입력과 같은 규칙).
   */
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
    if (event.shiftKey) return
    event.preventDefault()
    event.currentTarget.form?.requestSubmit()
  }

  const retryTurn = useCallback((turnId: string) => {
    const target = conversationRef.current.turns.find((turn) => turn.id === turnId)
    if (!target || selectStreamingTurn(conversationRef.current)) return
    dispatch({ kind: 'retry', id: turnId })
    void stream(turnId, target.question)
  }, [stream])

  const stopStreaming = () => {
    requestRef.current?.abort()
    dispatch({ kind: 'cancel' })
  }

  const notice = unavailableNotice ?? DEFAULT_UNAVAILABLE_NOTICE

  return (
    <>
      <div className="ai-chat-log" ref={logRef} onScroll={handleLogScroll}>
        {hasTurns
          ? conversation.turns.map((turn) => <AiChatTurn key={turn.id} turn={turn} onRetry={retryTurn} />)
          : (
            <>
              {/* 빈 상태는 대화가 하나도 없을 때만. 답변이 온 뒤에도 남아 있으면 이력을 밀어낸다. */}
              <div className="ai-empty">
                <img className="ai-empty__avatar" src={yeongsilImage} alt="AI 질문 도우미 영실" />
                <h3>한 번 아뢰어 보거라</h3>
                <p>{isAvailable ? emptyDescription : notice}</p>
              </div>
              {!isAvailable && <InlineNotice tone="warning">{notice}</InlineNotice>}
            </>
          )}
      </div>

      {hasTurns && !isFollowingLatest && (
        <div className="chat-latest-jump">
          <button type="button" onClick={scrollToLatest}>↓ 최신 답변으로 이동</button>
        </div>
      )}

      <form className="ai-composer" onSubmit={submitQuestion}>
        <label className="visually-hidden" htmlFor="ai-question-input">AI에게 할 질문</label>
        <textarea
          id="ai-question-input"
          rows={2}
          value={question}
          placeholder={placeholder}
          disabled={!isAvailable}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div className="ai-composer__row">
          <small>{isAvailable ? MEMORY_ONLY_NOTE : notice}</small>
          {/* 응답 중에는 전송 자리가 중단으로 바뀐다 — 좁은 패널에서 버튼을 늘리지 않고 겹침도 막는다. */}
          {isStreaming
            ? (
              <button className="button button--ghost button--small" type="button" onClick={stopStreaming}>
                답변 중단
              </button>
            )
            : (
              <button
                className="button button--primary button--small"
                type="submit"
                disabled={!isAvailable || question.trim().length === 0}
              >
                전송
              </button>
            )}
        </div>
      </form>
    </>
  )
}
