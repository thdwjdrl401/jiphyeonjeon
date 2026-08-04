import { useEffect, useId, useRef, useState } from 'react'
import { LiveReminderSetting } from './LiveReminderSetting'
import { useNotificationPreferenceQuery } from './useNotificationQueries'

interface LiveReminderPopoverProps {
  curriculumId: string
  lessonId?: string
  placement: 'hero' | 'panel'
}

/** 커리큘럼 또는 강의의 라이브 시작 알림을 해당 화면의 여유 공간에서 설정하는 팝오버. */
export default function LiveReminderPopover({
  curriculumId,
  lessonId,
  placement,
}: LiveReminderPopoverProps) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const panelId = useId()
  const headingId = useId()
  const preferenceQuery = useNotificationPreferenceQuery(curriculumId, lessonId)
  const isDisabled = preferenceQuery.data?.enabled === false
  const heading = lessonId ? '이 강의 라이브 시작 알림' : '라이브 시작 알림'

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

  return (
    <div
      className={`live-reminder-popover live-reminder-popover--${placement}`}
      ref={containerRef}
    >
      <button
        ref={triggerRef}
        className={`live-reminder-popover__trigger${isDisabled ? ' is-disabled' : ''}`}
        type="button"
        aria-label={`라이브 시작 알림 설정${isDisabled ? ' (꺼짐)' : ''}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={() => setIsOpen((current) => !current)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18">
          <path
            d="M12 3.25a5 5 0 0 0-5 5v3.1c0 .55-.2 1.08-.56 1.5L5 14.55a1 1 0 0 0 .76 1.65h12.48a1 1 0 0 0 .76-1.65l-1.44-1.7a2.3 2.3 0 0 1-.56-1.5v-3.1a5 5 0 0 0-5-5Z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinejoin="round"
          />
          <path
            d="M9.75 18.45a2.35 2.35 0 0 0 4.5 0"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          {isDisabled && (
            <path
              className="live-reminder-popover__slash"
              d="M4 4l16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            />
          )}
        </svg>
      </button>

      {isOpen && (
        <div
          ref={panelRef}
          className="live-reminder-popover__panel"
          id={panelId}
          role="dialog"
          aria-labelledby={headingId}
          tabIndex={-1}
        >
          <header className="live-reminder-popover__header">
            <h2 id={headingId}>{heading}</h2>
            <button
              className="live-reminder-popover__close"
              type="button"
              aria-label="알림 설정 닫기"
              onClick={() => {
                setIsOpen(false)
                triggerRef.current?.focus()
              }}
            >
              ×
            </button>
          </header>
          <LiveReminderSetting curriculumId={curriculumId} lessonId={lessonId} />
        </div>
      )}
    </div>
  )
}
