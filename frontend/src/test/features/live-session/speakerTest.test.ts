import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  playSpeakerTest,
  SPEAKER_TEST_DURATION_MS,
  SPEAKER_TEST_STEPS,
} from '@/features/live-session/speakerTest'

/**
 * 스피커 테스트음은 화면에서 들어봐야만 확인되는 부분(실제 소리)과 코드로 고정할 수 있는
 * 부분(몇 개를, 어느 채널로, 언제, 얼마나)이 나뉜다. 후자를 여기서 못 박는다 —
 * 좌우 분리가 조용히 사라지면(pan 전부 0) 화면만 봐서는 알 수 없기 때문이다.
 */

interface FakeTone {
  frequency: number
  pan: number | null
  startAt: number
  stopAt: number | null
  gainEvents: Array<{ kind: 'set' | 'ramp'; value: number; at: number }>
}

let tones: FakeTone[] = []
let closed = false
let stereoPannerAvailable = true

function installFakeAudioContext() {
  tones = []
  closed = false

  // 구현은 구간마다 oscillator를 먼저 만들고 그 뒤에 gain·panner를 만든다. 그래서 노드를
  // "가장 최근 oscillator"에 묶으면 connect 호출 순서에 의존하지 않고 구간별로 모을 수 있다
  // (실제 코드는 connect보다 gain·pan 값 설정이 먼저다).
  let current: FakeTone | null = null

  class FakeAudioContext {
    currentTime = 10   // 0이 아닌 값이어야 오프셋 계산 실수가 드러난다.
    destination = { name: 'destination' }

    createOscillator() {
      const tone: FakeTone = {
        frequency: 0, pan: null, startAt: -1, stopAt: null, gainEvents: [],
      }
      tones.push(tone)
      current = tone
      return {
        type: 'sine',
        frequency: { set value(hz: number) { tone.frequency = hz } },
        connect: () => {},
        start: (at: number) => { tone.startAt = at },
        stop: (at?: number) => { tone.stopAt = at ?? 0 },
      }
    }

    createGain() {
      const tone = current
      return {
        gain: {
          setValueAtTime: (value: number, at: number) =>
            tone?.gainEvents.push({ kind: 'set', value, at }),
          exponentialRampToValueAtTime: (value: number, at: number) =>
            tone?.gainEvents.push({ kind: 'ramp', value, at }),
        },
        connect: () => {},
      }
    }

    createStereoPanner() {
      if (!stereoPannerAvailable) return undefined
      const tone = current
      return {
        pan: { set value(v: number) { if (tone) tone.pan = v } },
        connect: () => {},
      }
    }

    close() {
      closed = true
      return Promise.resolve()
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext)
}

describe('스피커 테스트음', () => {
  beforeEach(() => {
    stereoPannerAvailable = true
    installFakeAudioContext()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('약 3초에 걸쳐 좌·우·양쪽 세 구간을 재생한다', () => {
    // 예전 테스트음은 중앙 1초 미만 단발이라 좌우를 확인할 수 없었다.
    expect(SPEAKER_TEST_DURATION_MS).toBeGreaterThanOrEqual(2_500)
    expect(SPEAKER_TEST_DURATION_MS).toBeLessThanOrEqual(3_500)
    expect(SPEAKER_TEST_STEPS.map((step) => step.channel)).toEqual(['left', 'right', 'both'])

    playSpeakerTest()

    expect(tones).toHaveLength(3)
    expect(tones.map((tone) => tone.pan)).toEqual([-1, 1, 0])
  })

  it('구간이 겹치지 않게 순서대로 예약한다', () => {
    playSpeakerTest()

    // 구간이 겹치면 좌우가 동시에 울려 판단이 불가능해진다.
    for (let index = 1; index < tones.length; index += 1) {
      expect(tones[index].startAt).toBeGreaterThan(tones[index - 1].stopAt!)
    }
    // currentTime(10)을 무시하고 0부터 예약하면 전부 과거 시각이 되어 한꺼번에 울린다.
    expect(tones[0].startAt).toBeGreaterThan(10)
  })

  it('각 구간을 무음에서 올리고 무음으로 내린다', () => {
    playSpeakerTest()

    for (const tone of tones) {
      const [first] = tone.gainEvents
      const last = tone.gainEvents[tone.gainEvents.length - 1]
      // 각지게 시작·종료하면 클릭음이 테스트음보다 크게 들린다.
      expect(first.value).toBeLessThan(0.001)
      expect(last.value).toBeLessThan(0.001)
      expect(Math.max(...tone.gainEvents.map((event) => event.value))).toBeGreaterThan(0.05)
    }
  })

  it('구간이 시작될 때 채널을 알리고 끝나면 종료를 알린다', () => {
    const onStep = vi.fn()
    const onEnd = vi.fn()

    playSpeakerTest({ onStep, onEnd })

    vi.advanceTimersByTime(SPEAKER_TEST_DURATION_MS)
    expect(onStep.mock.calls.map(([channel]) => channel)).toEqual(['left', 'right', 'both'])
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('중단하면 남은 음과 알림을 모두 끊는다', () => {
    const onStep = vi.fn()
    const onEnd = vi.fn()

    const stop = playSpeakerTest({ onStep, onEnd })
    stop()
    vi.advanceTimersByTime(SPEAKER_TEST_DURATION_MS)

    // 다시 듣기로 겹쳐 울리거나, 화면을 떠난 뒤 소리가 남으면 안 된다.
    expect(onStep).not.toHaveBeenCalled()
    expect(onEnd).not.toHaveBeenCalled()
    expect(tones.every((tone) => tone.stopAt !== null)).toBe(true)
    expect(closed).toBe(true)
  })

  it('StereoPanner가 없는 브라우저에서도 소리는 난다', () => {
    // 좌우 분리는 포기하되 "들리는지" 확인은 남긴다.
    stereoPannerAvailable = false
    const onEnd = vi.fn()

    playSpeakerTest({ onEnd })
    vi.advanceTimersByTime(SPEAKER_TEST_DURATION_MS)

    expect(tones).toHaveLength(3)
    expect(tones.every((tone) => tone.pan === null)).toBe(true)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('Web Audio가 없어도 화면 흐름은 멈추지 않는다', () => {
    // 소리를 못 내는 환경에서 '재생 중'에 갇히면 학생이 입장 자체를 못 한다.
    vi.stubGlobal('AudioContext', undefined)
    const onEnd = vi.fn()

    playSpeakerTest({ onEnd })
    vi.advanceTimersByTime(SPEAKER_TEST_DURATION_MS)

    expect(onEnd).toHaveBeenCalledTimes(1)
  })
})
