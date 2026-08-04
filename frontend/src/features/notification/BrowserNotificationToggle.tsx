import { useEffect, useId, useRef, useState } from 'react'
import { usePushSubscription } from './usePushSubscription'

/**
 * 전체 알림 페이지 헤더 우측의 압축 토글. "이 브라우저에서 알림 받기"를 스위치 하나로 줄인다 —
 * 큰 카드로 상태를 풀어 설명할 이유는 크지 않다: 여기서 끄는 것은 브라우저 권한이 아니라 이
 * 기기의 구독이고(권한 회수는 브라우저 설정의 몫이다), 어떤 알림을 만들지는 강의·커리큘럼의
 * 미리 알림 설정이 따로 정하며, 이 스위치를 꺼도 알림은 이 페이지 목록에 그대로 쌓인다.
 *
 * <p>스위치로 표현할 수 없는 상태만 다르게 그린다. 지원하지 않는 브라우저에서도 스위치 자체는
 * 그대로 두고 회색으로 비활성화한다 — 페이지마다 이 자리가 있다 없다 하면 레이아웃이 흔들리고,
 * "왜 없지"보다 "눌러도 안 되는구나"가 더 분명하다. 차단은 다시 물을 수 없으므로(브라우저가
 * 스크립트의 재요청 자체를 막는다) 스위치를 두지 않고, 대신 문구를 누르면 되돌리는 방법을
 * 안내하는 팝오버가 열린다 — 되짚어 볼 사람만 열어 보면 되므로 평소에는 문구 한 줄로 충분하다.
 */
export default function BrowserNotificationToggle() {
  const push = usePushSubscription(true)
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()
  const headingId = useId()

  useEffect(() => {
    if (!isOpen) return

    panelRef.current?.focus()

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setIsOpen(false)
      triggerRef.current?.focus()
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  if (push.state === 'denied') {
    return (
      <div className="browser-notification-toggle browser-notification-toggle--blocked" ref={containerRef}>
        <button
          ref={triggerRef}
          type="button"
          className="browser-notification-toggle__blocked-trigger"
          aria-haspopup="dialog"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((current) => !current)}
        >
          <span>브라우저 알림 차단됨</span>
          <svg aria-hidden="true" viewBox="0 0 24 24" width="14" height="14">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <line x1="12" y1="11" x2="12" y2="16.25" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            <circle cx="12" cy="7.6" r="1.05" fill="currentColor" stroke="none" />
          </svg>
        </button>

        {isOpen && (
          <div
            ref={panelRef}
            id={panelId}
            className="browser-notification-toggle__blocked-panel"
            role="dialog"
            aria-labelledby={headingId}
            tabIndex={-1}
          >
            <header>
              <h2 id={headingId}>차단 해제 방법</h2>
              <button
                type="button"
                className="browser-notification-toggle__blocked-close"
                aria-label="닫기"
                onClick={() => {
                  setIsOpen(false)
                  triggerRef.current?.focus()
                }}
              >
                ×
              </button>
            </header>
            <p>
              주소창 왼쪽 자물쇠(또는 정보) 아이콘을 누르고 <b>알림</b>을 «허용»으로 바꾼 뒤
              페이지를 새로고침하면 다시 켤 수 있습니다.
            </p>
          </div>
        )}
      </div>
    )
  }

  const isUnavailable = push.state === 'unavailable'
  const isOn = push.state === 'on'
  return (
    <button
      className="browser-notification-toggle"
      type="button"
      role="switch"
      aria-checked={isOn}
      aria-label="이 브라우저에서 알림 받기"
      title={isUnavailable ? '이 브라우저는 알림을 지원하지 않습니다.' : undefined}
      disabled={isUnavailable || push.state === 'working'}
      onClick={() => void (isOn ? push.disable() : push.enable())}
    >
      <span className="browser-notification-toggle__label">브라우저 알림</span>
      {/* 반으로 나뉜 직사각형 — 선택된 쪽만 색을 채우고, 선택 안 된 쪽은 흰 배경에 글자만 남는다. */}
      <span className="browser-notification-toggle__segments">
        <span className="browser-notification-toggle__segment browser-notification-toggle__segment--off">꺼짐</span>
        <span className="browser-notification-toggle__segment browser-notification-toggle__segment--on">켜짐</span>
      </span>
    </button>
  )
}
