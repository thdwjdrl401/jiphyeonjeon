import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react'
import yeongsilImage from '@/assets/yeongsil.png'
import type { AiAnswerHistoryItem, AiAnswerSource, AiAnswerStreamOptions } from '@/features/live-session/liveSessionService'
import { InlineNotice } from '@/shared/ui/WorkspaceUi'
import AiChatTurn from './AiChatTurn'
import {
  emptyAiConversationState,
  reduceAiConversation,
  selectStreamingTurn,
  type AiConversationState,
  type AiConversationTurn,
} from './aiConversation'

export type AskAiAnswer = (question: string, options: AiAnswerStreamOptions) => Promise<void>

interface PersonalAiQuestionPanelProps {
  /**
   * 질문 한 건을 보내고 SSE 이벤트를 흘리는 함수. **없으면 미지원 모드**로 그린다 —
   * 라이브에서 대화가 닫힌 상태(종료 뒤 정책 등)가 그 경우다.
   */
  ask?: AskAiAnswer
  /** 미지원 모드에서 왜 쓸 수 없는지. `ask`가 없을 때만 쓰인다. */
  unavailableNotice?: string
  placeholder?: string
  /** 빈 상태에서 무엇을 근거로 답하는지 안내. */
  emptyDescription?: string
  /**
   * 서버에 남은 내 질문 기록. 새로고침·재접속 뒤 대화를 되살린다.
   *
   * 없으면(기록 경로가 없는 화면) 예전처럼 이 컴포넌트가 사는 동안만 남는다.
   */
  history?: AiAnswerHistoryItem[]
  /**
   * 세션-ms 자막 근거를 눌렀을 때 영상을 옮긴다(다시보기, ADR-0075). 라이브는 넘기지 않는다 —
   * 라이브 근거는 attempt-local 축이라 이동할 좌표가 아니다.
   */
  onSeekEvidence?: (sessionMs: number) => void
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
/**
 * 서버 기록 한 건을 화면의 턴으로 옮긴다.
 *
 * 근거(`sources`)는 서버가 해석하지 않는 JSON 문자열이라 여기서 처음 읽는다 — 형식이 어긋나면
 * 근거만 비우고 답변은 살린다(근거 때문에 읽던 답이 사라지면 안 된다).
 */
function toRestoredTurn(item: AiAnswerHistoryItem): AiConversationTurn {
  let sources: AiAnswerSource[] = []
  try {
    const parsed: unknown = JSON.parse(item.sources || '[]')
    if (Array.isArray(parsed)) sources = parsed as AiAnswerSource[]
  } catch {
    sources = []
  }
  const status = item.status === 'DONE' ? 'done' : item.status === 'INSUFFICIENT' ? 'insufficient' : 'error'
  return {
    id: `history-${item.requestId}`,
    status,
    question: item.question,
    text: item.answer,
    sources,
    notice: status === 'error' ? '이 답변은 끝까지 받지 못했습니다.' : '',
    code: item.failureCode,
    // 지난 대화는 다시 시도하지 않는다 — 그때의 문맥(자막 위치)이 이미 달라졌다.
    retryable: false,
  }
}

export default function PersonalAiQuestionPanel({
  ask,
  unavailableNotice,
  placeholder = DEFAULT_PLACEHOLDER,
  emptyDescription = '강의 자료와 현재까지의 발화를 근거로 답변합니다.',
  history,
  onSeekEvidence,
}: PersonalAiQuestionPanelProps) {
  const [conversation, dispatch] = useReducer(reduceAiConversation, emptyAiConversationState)
  const [question, setQuestion] = useState('')
  const [isInfoOpen, setInfoOpen] = useState(false)
  const infoPopoverId = useId()
  const infoRef = useRef<HTMLDivElement>(null)
  // 진행 중인 요청의 중단 핸들. 새 질문·취소·언마운트가 모두 같은 핸들을 끊는다.
  const requestRef = useRef<AbortController | null>(null)
  const turnSequence = useRef(0)
  // 이벤트 핸들러가 최신 이력을 보되 콜백 정체성은 유지하도록 두는 거울. 턴 memo가 이것에 달려 있다.
  const conversationRef = useRef<AiConversationState>(conversation)
  const logRef = useRef<HTMLDivElement>(null)
  const [isFollowingLatest, setIsFollowingLatest] = useState(true)
  // 직전 렌더가 남긴 스크롤 높이(아래 layout effect에서 "이 갱신 전에 바닥에 있었는가"를 재는 기준).
  const previousScrollHeightRef = useRef(0)

  /*
   * 기록이 도착하면 대화를 되살린다. 리듀서가 "이미 턴이 있거나 진행 중이면 무시"를 지키므로,
   * 늦게 온 조회가 지금 흐르는 답변을 지우거나 같은 대화를 두 번 쌓지 않는다.
   */
  useEffect(() => {
    if (!history || history.length === 0) return
    dispatch({ kind: 'restore', turns: history.map(toRestoredTurn) })
  }, [history])

  const isAvailable = Boolean(ask)
  const streamingTurn = selectStreamingTurn(conversation)
  const isStreaming = streamingTurn !== null
  const hasTurns = conversation.turns.length > 0

  useEffect(() => { conversationRef.current = conversation }, [conversation])
  useEffect(() => () => requestRef.current?.abort(), [])
  // 안내 드롭다운 바깥을 누르면 닫는다 — 열려 있을 때만 듣는다.
  useEffect(() => {
    if (!isInfoOpen) return
    const handlePointerDown = (event: PointerEvent) => {
      if (!infoRef.current?.contains(event.target as Node)) setInfoOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [isInfoOpen])
  useEffect(() => {
    if (isAvailable) return
    requestRef.current?.abort()
    requestRef.current = null
    if (selectStreamingTurn(conversationRef.current)) {
      dispatch({ kind: 'cancel' })
    }
  }, [isAvailable])

  /*
   * 새 턴·새 델타를 따라 하단으로 붙는다. 위로 올려 읽는 중이면 건드리지 않는다 — 단, "읽는 중"을
   * isFollowingLatest(state) 대신 DOM의 실제 scrollTop으로 직접 잰다.
   *
   * 스트리밍 중에는 델타가 초당 여러 번 도착해 리렌더가 아주 잦다. isFollowingLatest는 'scroll'
   * 이벤트가 와야 갱신되는데, 사용자가 막 위로 스크롤한 직후 그 이벤트가 미처 처리되기 전에 다음
   * 델타로 또 리렌더가 오면, 아직 갱신 전인 "따라가는 중(true)"을 보고 강제로 바닥까지 끌어내린다
   * — 위로 올려도 곧바로 도로 내려가는 것처럼 보인다. DOM의 scrollTop은 이벤트 지연과 무관하게
   * 항상 지금 값을 주므로, "이 갱신 직전에 바닥에 있었는가"를 직전 렌더의 scrollHeight 기준으로
   * 직접 재면 이 경합이 생기지 않는다.
   */
  useLayoutEffect(() => {
    const log = logRef.current
    if (!log) return
    const wasAtBottom = log.scrollTop + log.clientHeight >= previousScrollHeightRef.current - FOLLOW_THRESHOLD_PX
    if (wasAtBottom) {
      log.scrollTop = log.scrollHeight
      // scrollTop을 코드로 옮기는 것만으로는 'scroll' 이벤트가 (제때) 오지 않는다 — 버튼 표시가
      // 이 스크롤과 어긋나지 않도록 상태도 바로 맞춘다.
      setIsFollowingLatest(true)
    }
    previousScrollHeightRef.current = log.scrollHeight
  }, [conversation])

  const handleLogScroll = () => {
    const log = logRef.current
    if (!log) return
    const distanceFromBottom = log.scrollHeight - log.scrollTop - log.clientHeight
    setIsFollowingLatest(distanceFromBottom <= FOLLOW_THRESHOLD_PX)
    // 실제 스크롤이 있었던 순간의 높이로도 기준을 맞춰 둔다 — 마운트 이후 한 번도 새 델타가
    // 오지 않은 채로 시간이 지나면(레이아웃이 바뀌는 등) 아래 effect의 기준이 낡을 수 있다.
    previousScrollHeightRef.current = log.scrollHeight
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
    // 전송은 "지금 여기를 보여 달라"는 명시적 요청이다 — 위로 올려 지난 대화를 읽던 중이었어도
    // 방금 보낸 질문은 지금 스크롤 위치와 무관하게 보여준다(채팅 패널의 내 메시지와 같은 규칙).
    setQuestion('')
    scrollToLatest()
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
      <div className="scroll-pane">
        <div className="ai-chat-log" ref={logRef} onScroll={handleLogScroll}>
          {hasTurns
            ? conversation.turns.map((turn) => (
                <AiChatTurn key={turn.id} turn={turn} onRetry={isAvailable ? retryTurn : undefined} onSeek={onSeekEvidence} />
              ))
            : (
              <>
                {/* 빈 상태는 대화가 하나도 없을 때만. 답변이 온 뒤에도 남아 있으면 이력을 밀어낸다. */}
                <div className="ai-empty">
                  <img className="ai-empty__avatar" src={yeongsilImage} alt="AI 질문 도우미 영실" />
                  <h3>여쭙거라</h3>
                  <p>{isAvailable ? emptyDescription : notice}</p>
                </div>
                {!isAvailable && <InlineNotice tone="warning">{notice}</InlineNotice>}
              </>
            )}
        </div>

        {hasTurns && !isFollowingLatest && (
          <div className="latest-jump">
            <button type="button" onClick={scrollToLatest}>↓ 최신 답변으로 이동</button>
          </div>
        )}
      </div>

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
        <div className="ai-composer__side">
          <div className="ai-composer__info" ref={infoRef}>
            <button
              aria-controls={infoPopoverId}
              aria-expanded={isInfoOpen}
              className="ai-composer__info-button"
              onClick={() => setInfoOpen((open) => !open)}
              type="button"
            >
              <span aria-hidden="true">i</span>
              <span className="visually-hidden">대화 보관 안내</span>
            </button>
            {/* 접혀도 DOM에 남긴다 — aria-controls가 가리키는 대상이 사라지면 참조가 끊긴다(근거 토글과 같은 요령). */}
            <div className="ai-composer__info-popover" hidden={!isInfoOpen} id={infoPopoverId} role="note">
              {MEMORY_ONLY_NOTE}
            </div>
          </div>
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
        {!isAvailable && <small className="ai-composer__notice">{notice}</small>}
      </form>
    </>
  )
}
