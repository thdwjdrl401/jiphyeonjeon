/**
 * 입장 전 점검의 스피커 테스트음. 외부 오디오 자산 없이 Web Audio로 직접 만든다.
 *
 * 좌 → 우 → 양쪽 3단으로 약 3초간 재생한다. 한쪽만 울리는 구간이 있어야 학생이
 * "한쪽 스피커가 죽었다"·"좌우가 뒤바뀌었다"를 스스로 알아챌 수 있다. 예전에는 중앙에서
 * 1초 미만 삐 소리 한 번이라, 소리가 났는지조차 확신하기 어렵고 좌우는 확인할 수 없었다.
 *
 * 음높이를 단계마다 올리는 이유(C5→E5→G5): 화면을 보지 않아도 몇 번째 구간인지 들리고,
 * 한 구간이 빠지면 화음이 끊겨 바로 이상하게 들린다.
 */

export type SpeakerTestChannel = 'left' | 'right' | 'both'

export interface SpeakerTestStep {
  channel: SpeakerTestChannel
  /** 테스트 시작 기준 오프셋(ms). */
  startMs: number
  /** 소리가 나는 길이(ms). */
  durationMs: number
  /** 음높이(Hz). */
  frequency: number
}

export const SPEAKER_TEST_STEPS: readonly SpeakerTestStep[] = [
  { channel: 'left', startMs: 0, durationMs: 800, frequency: 523.25 },
  { channel: 'right', startMs: 1000, durationMs: 800, frequency: 659.25 },
  { channel: 'both', startMs: 2000, durationMs: 950, frequency: 783.99 },
]

/** 전체 길이(ms). 단계 정의에서 파생시켜 둘이 어긋나지 않게 한다. */
export const SPEAKER_TEST_DURATION_MS = SPEAKER_TEST_STEPS
  .reduce((end, step) => Math.max(end, step.startMs + step.durationMs), 0)

export const SPEAKER_TEST_CHANNEL_LABEL: Record<SpeakerTestChannel, string> = {
  left: '왼쪽',
  right: '오른쪽',
  both: '양쪽',
}

/** StereoPanner 값. -1은 완전 왼쪽, +1은 완전 오른쪽. */
const CHANNEL_PAN: Record<SpeakerTestChannel, number> = { left: -1, right: 1, both: 0 }

const PEAK_GAIN = 0.18
const ATTACK_SEC = 0.03
const RELEASE_SEC = 0.12
/** exponentialRamp는 0을 못 받는다. 사실상 무음인 최소값. */
const SILENT_GAIN = 0.0001

interface PlaySpeakerTestOptions {
  /** 각 구간이 시작될 때 어느 채널인지 알린다(화면 표시를 소리와 맞추기 위함). */
  onStep?: (channel: SpeakerTestChannel) => void
  /** 마지막 구간까지 끝났을 때. */
  onEnd?: () => void
}

function createAudioContext(): AudioContext | null {
  const AudioCtx = window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  return AudioCtx ? new AudioCtx() : null
}

function scheduleTone(ctx: AudioContext, step: SpeakerTestStep, startAt: number) {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  const duration = step.durationMs / 1000
  const release = Math.min(RELEASE_SEC, duration / 2)

  oscillator.type = 'sine'
  oscillator.frequency.value = step.frequency

  // 시작·끝을 완전히 각지게 두면 스피커에서 '툭' 하는 클릭음이 난다 — 그 소리가 테스트음보다
  // 커서 정작 확인해야 할 음을 가린다. 짧은 attack/release로 감싼다.
  gain.gain.setValueAtTime(SILENT_GAIN, startAt)
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, startAt + ATTACK_SEC)
  gain.gain.setValueAtTime(PEAK_GAIN, startAt + duration - release)
  gain.gain.exponentialRampToValueAtTime(SILENT_GAIN, startAt + duration)

  oscillator.connect(gain)
  // StereoPannerNode가 없는 브라우저에서는 좌우 분리를 포기하고 중앙으로 낸다 —
  // 좌우 확인은 못 하지만 "소리가 나는지"는 여전히 확인할 수 있다.
  const panner = ctx.createStereoPanner?.()
  if (panner) {
    panner.pan.value = CHANNEL_PAN[step.channel]
    gain.connect(panner)
    panner.connect(ctx.destination)
  } else {
    gain.connect(ctx.destination)
  }

  oscillator.start(startAt)
  oscillator.stop(startAt + duration + 0.02)
  return oscillator
}

/**
 * 테스트음을 재생하고 중단 함수를 돌려준다.
 *
 * 중단 함수는 다시 듣기·화면 이탈에서 부른다 — 이전 재생이 남아 있으면 새 재생과 겹쳐
 * 좌우 판단이 불가능해진다. Web Audio를 못 쓰는 환경에서도 `onStep`·`onEnd`는 그대로
 * 흐른다(소리만 없다). 그래야 화면이 '재생 중'에서 멈추지 않는다.
 */
export function playSpeakerTest(options: PlaySpeakerTestOptions = {}): () => void {
  const ctx = createAudioContext()
  const oscillators: OscillatorNode[] = []
  const timers: number[] = []
  let stopped = false

  if (ctx) {
    const base = ctx.currentTime + 0.05   // 스케줄 여유. 0으로 두면 첫 음의 attack이 잘린다.
    for (const step of SPEAKER_TEST_STEPS) {
      oscillators.push(scheduleTone(ctx, step, base + step.startMs / 1000))
    }
  }

  for (const step of SPEAKER_TEST_STEPS) {
    timers.push(window.setTimeout(() => options.onStep?.(step.channel), step.startMs))
  }
  timers.push(window.setTimeout(() => options.onEnd?.(), SPEAKER_TEST_DURATION_MS))

  return () => {
    if (stopped) return
    stopped = true
    timers.forEach((timer) => window.clearTimeout(timer))
    oscillators.forEach((oscillator) => {
      try {
        oscillator.stop()
      } catch {
        // 이미 끝난 oscillator를 다시 멈추는 건 오류가 아니다.
      }
    })
    void ctx?.close()
  }
}
