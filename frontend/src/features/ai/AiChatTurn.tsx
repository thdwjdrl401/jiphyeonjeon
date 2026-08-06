import { memo } from 'react'
import yeongsilImage from '@/assets/yeongsil.png'
import AiEvidenceList from './AiEvidenceList'
import type { AiConversationTurn } from './aiConversation'

interface AiChatTurnProps {
  turn: AiConversationTurn
  /** 실패한 턴을 같은 질문으로 다시 보낸다. */
  onRetry?: (turnId: string) => void
  /** 세션-ms 자막 근거를 눌렀을 때 영상을 옮긴다(다시보기 전용, ADR-0075). */
  onSeek?: (sessionMs: number) => void
}

/**
 * 대화 한 턴(내 질문 + AI 답변) 말풍선.
 *
 * `memo`로 감싼 이유는 성능이 아니라 **스트리밍**이다 — 델타가 초당 여러 번 도착하는데, 이력 리듀서가
 * 바뀐 턴만 새 객체로 갈아 주므로(`aiConversation.applyToTurn`) 지난 턴들은 이 비교에서 걸러진다.
 * 그래서 props는 턴 객체와 **안정 콜백** 하나로만 유지한다.
 */
function AiChatTurn({ turn, onRetry, onSeek }: AiChatTurnProps) {
  const isStreaming = turn.status === 'streaming'
  const isError = turn.status === 'error'

  return (
    <article className="ai-turn">
      <div className="ai-bubble ai-bubble--mine">
        <span className="visually-hidden">내 질문</span>
        <p>{turn.question}</p>
      </div>
      <div className="ai-turn__answer">
        <img className="ai-turn__avatar" src={yeongsilImage} alt="" aria-hidden="true" />
        <div className={`ai-bubble ai-bubble--ai ai-answer${isStreaming ? ' is-streaming' : ''}`}>
          <span className="visually-hidden">AI 답변</span>
          {/* 스트리밍 중에는 스크린리더가 조각마다 읽지 않도록 polite로 두고, 끝난 뒤 전문이 남는다.
              텍스트가 아직 없어도 스트리밍이면 비워 둔 채 먼저 그린다 — live 영역이 뒤늦게 생기면 안 읽힌다. */}
          {(isStreaming || turn.text.length > 0) && (
            <p aria-live="polite" aria-busy={isStreaming}>{turn.text}</p>
          )}
          {isStreaming && (
            <small className="ai-answer__pending"><i aria-hidden="true" />답변을 작성하고 있습니다…</small>
          )}
          {/* insufficient는 오류가 아니다 — alert로 알리지 않고 안내 톤으로만 남긴다. */}
          {!isStreaming && turn.notice && (
            <p className={`ai-answer__notice${isError ? ' is-error' : ''}`} role={isError ? 'alert' : undefined}>
              {turn.notice}
            </p>
          )}
          <AiEvidenceList onSeek={onSeek} sources={turn.sources} />
          {isError && turn.retryable && onRetry && (
            <div className="ai-answer__actions">
              <button className="button button--soft button--small" type="button" onClick={() => onRetry(turn.id)}>
                다시 시도
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}

export default memo(AiChatTurn)
