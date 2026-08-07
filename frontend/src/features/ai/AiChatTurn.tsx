import { memo } from 'react'
import yeongsilImage from '@/assets/yeongsil.png'
import Markdown from '@/shared/ui/Markdown'
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
          {/* 모델은 Markdown으로 답한다 — 계약에 형식 제약이 없어(`answer.delta.text`) 목록·굵게·표가
              그대로 온다. 평문으로 찍던 동안 `**이것**`이 별표째 보였다.

              스트리밍 중에도 계속 그린다. "끝난 뒤에 한 번에 바꾸기"가 안전해 보이지만 더 나쁘다 —
              튀는 것을 없애는 게 아니라 다 읽은 문단까지 마지막에 몰아서 재배치한다. 계속 그리면
              아직 안 읽은 마지막 줄만 흔들린다. 비용은 문제가 아니다(답변이 수천 자 안쪽이고 이 컴포넌트가
              memo라 지난 턴은 다시 그리지 않는다). */}
          {(isStreaming || turn.text.length > 0) && (
            <div className="ai-answer__body" aria-busy={isStreaming}>
              <Markdown markdown={turn.text} />
            </div>
          )}
          {/* 본문을 live 영역에 두지 않는다. 평문일 때는 글자가 덧붙기만 해서 polite로 흘려도 됐지만,
              Markdown은 굵게가 닫히거나 표가 서는 순간 그 부분이 통째로 갈린다 — live 영역이면
              스크린리더가 답변을 처음부터 다시 읽는다. 완성됐다는 사실만 한 번 알리고 본문은 직접 읽게 한다. */}
          <span aria-live="polite" className="visually-hidden">
            {!isStreaming && turn.text.length > 0 ? '답변이 완성되었습니다.' : ''}
          </span>
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
