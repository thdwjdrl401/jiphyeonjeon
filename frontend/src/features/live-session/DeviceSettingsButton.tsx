import { useEffect, useId, useRef, useState } from 'react'
import DevicePicker from './DevicePicker'
import type { InstructorLiveMedia } from './useInstructorLiveKit'

interface DeviceSettingsButtonProps {
  publisher: InstructorLiveMedia
}

function GearIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3.2" />
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.6 1.6 0 0 0 9 19.4a1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.6 1.6 0 0 0 4.6 9a1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"
      />
    </svg>
  )
}

/**
 * 강의 중 카메라·마이크를 바꾸는 자리.
 *
 * <p>마이크·카메라 버튼 <b>옆에</b> 둔다. 켜고 끄는 것과 무엇으로 켤지는 같은 결정의 앞뒤라,
 * 엉뚱한 장치가 잡힌 걸 알아채는 순간 손이 가는 곳도 거기다.
 *
 * <p><b>펼쳤을 때만 목록을 그린다.</b> 컨트롤 줄은 영상 위에 떠 있어 자리가 없고, 장치를 바꾸는 일은
 * 강의 내내 몇 번 없다. 바꾸면 트랙이 잠깐 끊기지만 재발행이 아니라 소스만 갈리는 것이라
 * (LiveKit `switchActiveDevice`) 수강생 쪽 구독과 자막은 그대로 이어진다.
 */
export default function DeviceSettingsButton({ publisher }: DeviceSettingsButtonProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return undefined

    /*
     * 바깥을 누르거나 Escape면 닫는다. 영상 위에 떠 있는 패널이라 열어 둔 채로 두면 화면을 가린다.
     * pointerdown으로 듣는다 — click은 버튼을 누른 뒤에 와서, 방금 연 패널이 곧바로 닫힌다.
     */
    const closeOnOutside = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  return (
    <div className="device-settings" ref={containerRef}>
      <button
        aria-controls={open ? panelId : undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label="입력 장치 설정"
        className={open ? 'is-active' : ''}
        disabled={!publisher.canControl}
        title="카메라·마이크 고르기"
        type="button"
        onClick={() => setOpen((current) => !current)}
      >
        <GearIcon />
        장치
      </button>
      {open && (
        <div className="device-settings__panel" id={panelId} role="dialog" aria-label="입력 장치 설정">
          <DevicePicker
            publisher={publisher}
            kind="videoinput"
            label="카메라"
            emptyHint="연결된 카메라를 찾지 못했습니다."
          />
          <DevicePicker
            publisher={publisher}
            kind="audioinput"
            label="마이크"
            emptyHint="연결된 마이크를 찾지 못했습니다."
          />
          {/* 바꾸는 순간 잠깐 끊긴다. 말하는 중에 눌렀다가 놀라지 않도록 미리 말한다. */}
          <p className="device-settings__hint">바꾸면 잠깐 끊겼다가 새 장치로 이어집니다.</p>
        </div>
      )}
    </div>
  )
}
