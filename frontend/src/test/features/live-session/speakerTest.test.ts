import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  playSpeakerTest,
  SPEAKER_TEST_DURATION_MS,
  SPEAKER_TEST_STEPS,
} from '@/features/live-session/speakerTest'

/**
 * 스피커 테스트음은 화면에서 들어봐야만 확인되는 부분(실제 음색)과 코드로 고정할 수 있는
 * 부분(몇 개를, 어느 채널로, 언제, 얼마나, 어떤 엔벨로프로)이 나뉜다. 후자를 여기서 못 박는다 —
 * 좌우 분리가 조용히 사라지거나(pan 전부 0) 엔벨로프가 지속음으로 되돌아가면(= 부저)
 * 화면만 봐서는 알 수 없기 때문이다.
 */

interface FakeTone {
  frequency: number
  startAt: number
  stopAt: number | null
  gainEvents: Array<{ kind: 'set' | 'ramp'; value: number; at: number }>
}

let tones: FakeTone[] = []
/** createStereoPanner 호출마다의 pan 값. 구간당 하나여야 한다. */
let pans: number[] = []
/** `gain.value`로 직접 설정된 음량. 구간 출력(마스터) gain만 이 방식을 쓴다. */
let masterGains: number[] = []
let closed = false
let stereoPannerAvailable = true

function installFakeAudioContext() {
  tones = []
  pans = []
  masterGains = []
  closed = false

  // 구현은 구간마다 [출력 gain → panner] 를 만든 뒤 배음마다 [oscillator → gain] 을 만든다.
  // 배음 gain은 자기 oscillator 바로 뒤에 생기므로 "가장 최근 oscillator"에 묶으면 정확히
  // 대응된다. 구간 출력 gain은 스케줄 호출 없이 .value 대입만 하므로 masterGains로 따로 빠진다.
  let current: FakeTone | null = null

  class FakeAudioContext {
    currentTime = 10   // 0이 아닌 값이어야 오프셋 계산 실수가 드러난다.
    destination = { name: 'destination' }

    createOscillator() {
      const tone: FakeTone = { frequency: 0, startAt: -1, stopAt: null, gainEvents: [] }
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
          set value(v: number) { masterGains.push(v) },
          linearRampToValueAtTime: (value: number, at: number) =>
            tone?.gainEvents.push({ kind: 'ramp', value, at }),
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
      return {
        pan: { set value(v: number) { pans.push(v) } },
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

/**
 * 타격 단위로 oscillator를 모은다. 한 타격의 배음들은 모두 같은 시각에 시작하므로 startAt이
 * 곧 타격의 식별자다 — 구간당 한 번만 때리니 결과는 구간별 묶음과 같아야 한다.
 */
function strikes() {
  const byStart = new Map<number, FakeTone[]>()
  for (const tone of tones) {
    byStart.set(tone.startAt, [...(byStart.get(tone.startAt) ?? []), tone])
  }
  return [...byStart.entries()]
    .sort(([a], [b]) => a - b)
    .map(([startAt, group]) => ({ startAt, group }))
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
    // 음색만 바꾸는 변경에서 재생 순서·시간이 함께 흔들리지 않게 못 박는다.
    expect(SPEAKER_TEST_DURATION_MS).toBeGreaterThanOrEqual(2_500)
    expect(SPEAKER_TEST_DURATION_MS).toBeLessThanOrEqual(3_500)
    expect(SPEAKER_TEST_STEPS.map((step) => step.channel)).toEqual(['left', 'right', 'both'])
    expect(SPEAKER_TEST_STEPS.map((step) => step.startMs)).toEqual([0, 1_000, 2_000])

    playSpeakerTest()

    // 구간마다 panner 하나 — 배음마다 따로 만들면 같은 소리가 여러 경로로 나가 정위가 흐려진다.
    expect(pans).toEqual([-1, 1, 0])
  })

  it('구간마다 한 번만 때린다', () => {
    // 한 구간에서 두 번 때리면 두 여운이 겹쳐 두 음이 아니라 뭉개진 연속음으로 들린다.
    playSpeakerTest()

    expect(strikes()).toHaveLength(SPEAKER_TEST_STEPS.length)
  })

  it('사인파 하나가 아니라 배음을 쌓은 타격음이다', () => {
    // 부저처럼 들리던 원인 (1): 배음이 없는 사인파 한 개였다.
    playSpeakerTest()

    for (const { group } of strikes()) {
      expect(group.length).toBeGreaterThanOrEqual(4)
      // 배음은 서로 다른 주파수여야 한다(가장 낮은 것이 기본음).
      const base = Math.min(...group.map((tone) => tone.frequency))
      expect(new Set(group.map((tone) => tone.frequency)).size).toBe(group.length)
      for (const tone of group) expect(tone.frequency).toBeGreaterThanOrEqual(base)
    }
  })

  it('금속 질감을 내는 비정수배 배음이 섞여 있다', () => {
    // 배음이 전부 정수배면 오르간처럼 딱 맞아떨어져 '금속을 때린' 느낌이 사라진다.
    // 노이즈를 쓰지 않고 금속 질감을 내는 수단이라 조용히 정수배로 정리되면 안 된다.
    playSpeakerTest()

    for (const { group } of strikes()) {
      const base = Math.min(...group.map((tone) => tone.frequency))
      const ratios = group.map((tone) => tone.frequency / base)
      const offIntegerCount = ratios
        .filter((ratio) => Math.abs(ratio - Math.round(ratio)) > 0.1).length
      expect(offIntegerCount).toBeGreaterThanOrEqual(2)
    }
  })

  it('고역 배음이 기본음보다 먼저 사라진다', () => {
    // 배음이 전부 기본음만큼 길게 남으면 오르간 화음처럼 눌린 지속음이 되어 연속음으로 들린다.
    playSpeakerTest()

    for (const { startAt, group } of strikes()) {
      const base = Math.min(...group.map((tone) => tone.frequency))
      const ringOf = (tone: FakeTone) => tone.stopAt! - startAt
      const fundamental = group.find((tone) => tone.frequency === base)!
      const highest = group.reduce((a, b) => (a.frequency > b.frequency ? a : b))
      expect(ringOf(highest)).toBeLessThan(ringOf(fundamental))
    }
  })

  it('유지 구간 없이 치솟고 계속 잦아든다', () => {
    // 부저처럼 들리던 원인 (2): 엔벨로프가 지속음이었다(올린 뒤 일정 음량을 유지하다 내림).
    // 악기 타격음은 때린 순간이 가장 크고 계속 줄어든다 — 중간에 음량을 다시 고정하지 않는다.
    playSpeakerTest()

    for (const tone of tones) {
      const [first, ...rest] = tone.gainEvents
      expect(first).toMatchObject({ kind: 'set' })
      expect(first.value).toBeLessThan(0.001)          // 무음에서 시작
      // 이후는 램프만 — 중간에 'set'이 또 나오면 그 지점부터 음량이 유지된다(= 부저).
      expect(rest.every((event) => event.kind === 'ramp')).toBe(true)
      expect(rest[rest.length - 1].value).toBeLessThan(0.001)   // 무음으로 잦아든다
      // 최고점은 맨 앞 램프 하나뿐이고, 그 뒤로는 단조 감소한다.
      rest.forEach((event, index) => {
        if (index > 0) expect(event.value).toBeLessThan(rest[index - 1].value)
      })
    }
  })

  it('감쇠를 급감 → 여운 두 단계로 꺾는다', () => {
    // 최고점에서 무음까지 단일 exponentialRamp로 내리면 dB가 일정한 속도로 떨어져 기계적으로
    // 들린다. 실제 금속 타격음은 직후 급격히 작아지고 그 뒤 조용한 여운이 길게 남는다.
    playSpeakerTest()

    for (const tone of tones) {
      const ramps = tone.gainEvents.filter((event) => event.kind === 'ramp')
      // 최고점 + 꺾임 + 무음 = 최소 3개. 2개면 꺾임 없는 직선 감쇠로 되돌아간 것이다.
      expect(ramps.length).toBeGreaterThanOrEqual(3)
      const [peak, knee] = ramps
      expect(knee.value).toBeLessThan(peak.value)
      expect(knee.value).toBeGreaterThan(0.001)
      // 꺾임은 감쇠 앞쪽에서 일어난다 — 뒤쪽이면 급감이 아니라 완만한 감쇠가 된다.
      const silentAt = ramps[ramps.length - 1].at
      expect(knee.at - peak.at).toBeLessThan((silentAt - peak.at) / 2)
    }
  })

  it('음량을 한 번만 적용해 너무 작아지지 않는다', () => {
    // 배음 피크를 합이 1이 되게 정규화한 뒤 마스터 gain을 곱한다. 정규화와 마스터 gain에
    // 같은 값을 두 번 곱하면(PEAK_GAIN²) 실제 음량이 제곱으로 줄어 들리지 않을 만큼 작아진다.
    playSpeakerTest()

    expect(masterGains).toHaveLength(SPEAKER_TEST_STEPS.length)
    for (const gain of masterGains) {
      // 감쇠음은 유지음보다 에너지가 훨씬 적어 기존 부저(0.18)보다 큰 값이 필요하다.
      expect(gain).toBeGreaterThan(0.3)
      expect(gain).toBeLessThanOrEqual(0.8)   // 그래도 클리핑 헤드룸은 남긴다
    }

    for (const { group } of strikes()) {
      // 배음 피크의 합 — 동시에 최고점을 지나도 1을 넘지 않아야 클리핑하지 않는다.
      const peakSum = group.reduce((sum, tone) => {
        const ramps = tone.gainEvents.filter((event) => event.kind === 'ramp')
        return sum + ramps[0].value
      }, 0)
      expect(peakSum).toBeGreaterThan(0.9)
      expect(peakSum).toBeLessThanOrEqual(1.000001)
    }
  })

  it('구간이 겹치지 않게 순서대로 예약한다', () => {
    playSpeakerTest()

    // 구간이 겹치면 좌우가 동시에 울려 판단이 불가능해진다. 한 구간의 배음들은 같은 시각에
    // 시작하므로, 겹침은 배음이 아니라 '타격' 단위로 봐야 한다.
    const groups = strikes()
    for (let index = 1; index < groups.length; index += 1) {
      const previousEnd = Math.max(...groups[index - 1].group.map((tone) => tone.stopAt!))
      expect(groups[index].startAt).toBeGreaterThan(previousEnd)
    }
    // currentTime(10)을 무시하고 0부터 예약하면 전부 과거 시각이 되어 한꺼번에 울린다.
    expect(tones[0].startAt).toBeGreaterThan(10)
  })

  it('여운이 구간 길이를 넘지 않는다', () => {
    // 감쇠가 구간보다 길면 다음 구간과 겹쳐 좌우 판단이 흐려진다.
    playSpeakerTest()

    strikes().forEach(({ startAt, group }, index) => {
      const limit = SPEAKER_TEST_STEPS[index].durationMs / 1000
      for (const tone of group) {
        expect(tone.stopAt! - startAt).toBeLessThanOrEqual(limit)
      }
    })
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

    // 구간 3개는 그대로 울린다(배음이 있어 oscillator 수는 그보다 많다). pan만 적용되지 않는다.
    expect(strikes()).toHaveLength(SPEAKER_TEST_STEPS.length)
    expect(pans).toEqual([])
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
