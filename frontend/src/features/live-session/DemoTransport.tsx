import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { demoElement, subscribeDemoMedia } from './demoPublish'

/** 강의 중에 손이 가는 크기. 너무 크면 실수로 눌리고, 너무 작으면 급할 때 못 누른다. */
const SKIP_SECONDS = 10

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--:--'
  const total = Math.floor(seconds)
  const mm = String(Math.floor(total / 60)).padStart(2, '0')
  const ss = String(total % 60).padStart(2, '0')
  return `${mm}:${ss}`
}

/**
 * 데모 영상의 정지·재생·구간 이동(ADR-0100).
 *
 * <p><b>이건 로컬 재생 제어가 아니라 송출 제어다.</b> element를 멈추면 `captureStream()`이 내보내던
 * 프레임과 소리가 함께 멈춘다 — 수강생 화면이 정지 화면이 되고 녹화에도 그대로 남는다. 그래서
 * "일시정지"라고만 쓰지 않고 무엇이 멈추는지 화면에 적는다.
 *
 * <p><b>뒤로 감으면 자막이 겹친다.</b> STT가 이미 받은 구간을 다시 받으므로 강의 노트에 같은 주제가
 * 두 번 쌓인다. 앞으로 감으면 그 구간이 통째로 빠진다. 시연에서는 대개 괜찮지만 모르고 하면 안 된다.
 */
export default function DemoTransport() {
  // element는 송출을 시작해야 생긴다. 생기고 사라지는 것을 구독해 그때만 손잡이를 그린다.
  const element = useSyncExternalStore(subscribeDemoMedia, demoElement, () => null)
  const [paused, setPaused] = useState(true)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  /** 손잡이를 잡고 있는 동안에는 재생 위치가 값을 덮지 않게 한다 — 잡은 손이 튕겨 나간다. */
  const [scrubbing, setScrubbing] = useState<number | null>(null)

  useEffect(() => {
    if (!element) return
    const sync = () => {
      setPaused(element.paused)
      setCurrent(element.currentTime)
      setDuration(Number.isFinite(element.duration) ? element.duration : 0)
    }
    sync()
    // 우리를 거치지 않는 변화(반복 재생으로 0으로 되감김 등)도 화면에 그대로 반영되어야 한다.
    for (const event of ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'seeked']) {
      element.addEventListener(event, sync)
    }
    return () => {
      for (const event of ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'seeked']) {
        element.removeEventListener(event, sync)
      }
    }
  }, [element])

  const seekTo = useCallback((seconds: number) => {
    if (!element) return
    const max = Number.isFinite(element.duration) ? element.duration : seconds
    element.currentTime = Math.min(Math.max(seconds, 0), max)
  }, [element])

  if (!element) return null

  const shown = scrubbing ?? current

  return (
    <div className="demo-transport">
      <button
        className="button button--soft button--small"
        onClick={() => { void (element.paused ? element.play() : element.pause()) }}
        type="button"
      >
        {paused ? '재생' : '일시정지'}
      </button>
      <button
        aria-label={`${SKIP_SECONDS}초 뒤로`}
        className="button button--soft button--small"
        onClick={() => seekTo(current - SKIP_SECONDS)}
        type="button"
      >
        −{SKIP_SECONDS}초
      </button>
      <button
        aria-label={`${SKIP_SECONDS}초 앞으로`}
        className="button button--soft button--small"
        onClick={() => seekTo(current + SKIP_SECONDS)}
        type="button"
      >
        +{SKIP_SECONDS}초
      </button>
      <input
        aria-label="데모 영상 재생 위치"
        className="demo-transport__bar"
        max={duration || 0}
        min={0}
        onChange={(event) => setScrubbing(Number(event.target.value))}
        // 손을 뗄 때 한 번만 옮긴다. 끄는 내내 옮기면 매 프레임 seek이 걸려 송출이 끊긴다.
        onMouseUp={() => { if (scrubbing !== null) { seekTo(scrubbing); setScrubbing(null) } }}
        onKeyUp={() => { if (scrubbing !== null) { seekTo(scrubbing); setScrubbing(null) } }}
        onTouchEnd={() => { if (scrubbing !== null) { seekTo(scrubbing); setScrubbing(null) } }}
        step={0.1}
        type="range"
        value={shown}
      />
      <span className="demo-transport__time is-mono">
        {formatTime(shown)} / {formatTime(duration)}
      </span>
    </div>
  )
}
