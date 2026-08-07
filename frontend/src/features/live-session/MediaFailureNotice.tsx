import type { MediaFailure } from './mediaFailure'

/**
 * 장치가 안 열린 이유를 강사에게 말한다.
 *
 * <p>세 줄로 나눈다 — <b>무엇이</b>(title) · <b>왜</b>(detail) · <b>무엇을 하면 되는지</b>(action).
 * 한 줄로 뭉치면 강사가 읽어야 할 조치가 사고 설명에 묻힌다.
 *
 * <p>"다시 시도"는 <b>눌러서 달라질 때만</b> 낸다. 권한이 차단된 상태에서는 요청이 조용히 거절되므로,
 * 그 버튼은 브라우저 설정을 고쳐야 한다는 사실을 감추는 역할밖에 하지 않는다.
 */
export default function MediaFailureNotice({
  failure,
  onRetry,
  onDismiss,
  pending = false,
  className = '',
}: {
  failure: MediaFailure
  onRetry: () => void
  onDismiss?: () => void
  pending?: boolean
  className?: string
}) {
  return (
    <div className={`media-failure${failure.needsBrowserSetting ? ' media-failure--setting' : ''} ${className}`.trim()} role="alert">
      <strong className="media-failure__title">{failure.title}</strong>
      <p className="media-failure__detail">{failure.detail}</p>
      <p className="media-failure__action">{failure.action}</p>
      <div className="media-failure__buttons">
        {failure.retryable && (
          <button className="button button--soft button--small" disabled={pending} type="button" onClick={onRetry}>
            {pending ? '다시 시도하는 중…' : '다시 시도'}
          </button>
        )}
        {onDismiss && (
          <button className="button button--ghost button--small" type="button" onClick={onDismiss}>닫기</button>
        )}
      </div>
    </div>
  )
}
