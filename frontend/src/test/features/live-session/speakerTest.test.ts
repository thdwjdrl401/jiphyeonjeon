import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 스피커 테스트음은 화면에서 들어봐야만 확인되는 부분(실제 음색)과 코드로 고정할 수 있는
 * 부분(어느 채널로, 언제, 얼마나, 원본을 어떻게 다듬어서)이 나뉜다. 후자를 여기서 못 박는다.
 *
 * 특히 **앞쪽 무음 잘라내기**와 **모노 다운믹스**는 조용히 사라지면 화면만 봐서는 알 수 없다.
 * 앞쪽 무음이 남으면 표시가 소리보다 먼저 켜지고, 모노 다운믹스가 빠지면 "양쪽" 구간만 원본
 * 정위가 남아 세 구간의 음색·음량이 어긋난다.
 */

// 원본 음원을 흉내낸 값 — 실측한 특징을 그대로 재현한다.
const SAMPLE_RATE = 44_100
/** 원본 앞쪽 무음(실측 630ms). 잘라내지 않으면 표시가 소리보다 먼저 켜진다. */
const LEAD_SILENCE_SEC = 0.63
/** 소리가 나는 길이(실측 약 1.8초). 구간 길이(1.55초)보다 길어야 자르기가 검증된다. */
const SOUND_SEC = 1.8
/** 원본은 모노가 아니다 — L보다 R이 크다(실측 상관계수 0.95). */
const LEFT_AMPLITUDE = 0.4
const RIGHT_AMPLITUDE = 0.6

interface FakeSource {
  buffer: FakeAudioBuffer | null
  startAt: number
  stopAt: number | null
  gainEvents: Array<{ kind: 'set' | 'ramp'; value: number; at: number }>
}

class FakeAudioBuffer {
  readonly numberOfChannels: number
  readonly length: number
  readonly sampleRate: number
  private readonly data: Float32Array[]

  constructor(channels: number, length: number, sampleRate: number) {
    this.numberOfChannels = channels
    this.length = length
    this.sampleRate = sampleRate
    this.data = Array.from({ length: channels }, () => new Float32Array(length))
  }

  get duration() {
    return this.length / this.sampleRate
  }

  getChannelData(index: number) {
    return this.data[index]
  }
}

/** 실측 특징(앞쪽 무음 + 좌우 비대칭)을 가진 가짜 원본을 만든다. */
function makeSourceBuffer() {
  const leadFrames = Math.round(LEAD_SILENCE_SEC * SAMPLE_RATE)
  const soundFrames = Math.round(SOUND_SEC * SAMPLE_RATE)
  const buffer = new FakeAudioBuffer(2, leadFrames + soundFrames, SAMPLE_RATE)
  const left = buffer.getChannelData(0)
  const right = buffer.getChannelData(1)
  for (let i = 0; i < soundFrames; i += 1) {
    // 감쇠하는 사인파 — 최고점이 맨 앞에 오게 해서 정규화 기준을 분명히 한다.
    const decay = 1 - i / soundFrames
    const wave = Math.sin((2 * Math.PI * 880 * i) / SAMPLE_RATE) * decay
    left[leadFrames + i] = wave * LEFT_AMPLITUDE
    right[leadFrames + i] = wave * RIGHT_AMPLITUDE
  }
  return buffer
}

let sources: FakeSource[] = []
let pans: number[] = []
let closed = false
let resumed = 0
let stereoPannerAvailable = true
let decodeShouldFail = false
let fetchShouldFail = false
let decodeCalls = 0

function installFakes() {
  sources = []
  pans = []
  closed = false
  resumed = 0
  decodeCalls = 0

  let current: FakeSource | null = null

  class FakeAudioContext {
    currentTime = 10   // 0이 아닌 값이어야 오프셋 계산 실수가 드러난다.
    sampleRate = SAMPLE_RATE
    destination = { name: 'destination' }

    decodeAudioData(bytes: ArrayBuffer) {
      decodeCalls += 1
      // 이미 detach 된 버퍼가 오면 실패한다 — 실제 브라우저와 같은 반응.
      if (bytes.byteLength === 0) return Promise.reject(new Error('detached'))
      if (decodeShouldFail) return Promise.reject(new Error('unsupported codec'))
      // **실제 decodeAudioData는 넘겨받은 ArrayBuffer를 detach 한다.** 그 동작까지 흉내내야
      // "캐시한 원본을 사본 없이 넘긴다"는 회귀(= 다시 듣기가 조용히 무음)를 잡을 수 있다.
      structuredClone(bytes, { transfer: [bytes] })
      return Promise.resolve(makeSourceBuffer())
    }

    createBuffer(channels: number, length: number, sampleRate: number) {
      return new FakeAudioBuffer(channels, length, sampleRate)
    }

    createBufferSource() {
      const source: FakeSource = { buffer: null, startAt: -1, stopAt: null, gainEvents: [] }
      sources.push(source)
      current = source
      return {
        set buffer(value: FakeAudioBuffer | null) { source.buffer = value },
        get buffer() { return source.buffer },
        connect: () => {},
        start: (at: number) => { source.startAt = at },
        stop: (at?: number) => { source.stopAt = at ?? 0 },
      }
    }

    createGain() {
      const source = current
      return {
        gain: {
          setValueAtTime: (value: number, at: number) =>
            source?.gainEvents.push({ kind: 'set', value, at }),
          linearRampToValueAtTime: (value: number, at: number) =>
            source?.gainEvents.push({ kind: 'ramp', value, at }),
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

    resume() {
      resumed += 1
      return Promise.resolve()
    }

    close() {
      closed = true
      return Promise.resolve()
    }
  }

  vi.stubGlobal('AudioContext', FakeAudioContext)
  vi.stubGlobal('fetch', vi.fn(() => (fetchShouldFail
    ? Promise.reject(new Error('offline'))
    : Promise.resolve({ ok: true, arrayBuffer: () => Promise.resolve(new ArrayBuffer(4_096)) }))))
}

type SpeakerTestModule = typeof import('@/features/live-session/speakerTest')

let playSpeakerTest: SpeakerTestModule['playSpeakerTest']
let prefetchSpeakerTestChime: SpeakerTestModule['prefetchSpeakerTestChime']
let SPEAKER_TEST_STEPS: SpeakerTestModule['SPEAKER_TEST_STEPS']
let SPEAKER_TEST_DURATION_MS: number

/**
 * 재생을 시작하고 비동기 로드·디코딩이 끝날 때까지 흘린다.
 *
 * `playSpeakerTest`는 동기 함수(중단 함수를 바로 돌려준다)이지만 내부에서 fetch → decode를
 * 거치므로, 예약이 실제로 일어난 뒤에 검사해야 한다.
 */
async function settle() {
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
}

async function playAndSettle(options?: Parameters<SpeakerTestModule['playSpeakerTest']>[0]) {
  const stop = playSpeakerTest(options)
  await settle()
  return stop
}

describe('스피커 테스트음', () => {
  beforeEach(async () => {
    stereoPannerAvailable = true
    decodeShouldFail = false
    fetchShouldFail = false
    installFakes()
    vi.useFakeTimers()
    // 모듈 수준 음원 캐시를 비워 테스트 간 간섭을 없앤다.
    vi.resetModules()
    const mod = await import('@/features/live-session/speakerTest')
    playSpeakerTest = mod.playSpeakerTest
    prefetchSpeakerTestChime = mod.prefetchSpeakerTestChime
    SPEAKER_TEST_STEPS = mod.SPEAKER_TEST_STEPS
    SPEAKER_TEST_DURATION_MS = mod.SPEAKER_TEST_DURATION_MS
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('좌 → 우 → 양쪽 순서로 구간이 겹치지 않게 재생한다', async () => {
    expect(SPEAKER_TEST_STEPS.map((step) => step.channel)).toEqual(['left', 'right', 'both'])
    // 구간 사이에 침묵이 있어야 좌우가 어디서 바뀌었는지 알 수 있다.
    for (let i = 1; i < SPEAKER_TEST_STEPS.length; i += 1) {
      const previous = SPEAKER_TEST_STEPS[i - 1]
      expect(SPEAKER_TEST_STEPS[i].startMs)
        .toBeGreaterThan(previous.startMs + previous.durationMs)
    }

    await playAndSettle()

    expect(sources).toHaveLength(SPEAKER_TEST_STEPS.length)
    // 구간마다 panner 하나 — 여러 경로로 같은 소리를 내보내면 좌우 정위가 흐려진다.
    expect(pans).toEqual([-1, 1, 0])
    for (let i = 1; i < sources.length; i += 1) {
      expect(sources[i].startAt).toBeGreaterThan(sources[i - 1].stopAt!)
    }
    // currentTime(10)을 무시하고 0부터 예약하면 전부 과거 시각이 되어 한꺼번에 울린다.
    expect(sources[0].startAt).toBeGreaterThan(10)
  })

  it('"bing–bong" 두 음이 다 들어갈 만큼 구간이 길다', () => {
    // 원본 실측: 두 타격 간격 575ms, -30dB까지 1,505ms. 그보다 짧으면 "bong"이 잘린다.
    for (const step of SPEAKER_TEST_STEPS) {
      expect(step.durationMs).toBeGreaterThanOrEqual(1_505)
    }
    expect(SPEAKER_TEST_DURATION_MS).toBe(
      SPEAKER_TEST_STEPS[2].startMs + SPEAKER_TEST_STEPS[2].durationMs,
    )
  })

  it('원본 앞쪽 무음을 잘라낸다', async () => {
    // 원본은 앞에 630ms 무음이 있다. 그대로 재생하면 "왼쪽 재생 중" 표시가 소리보다 먼저 켜져
    // 학생이 "왼쪽은 안 들렸다"고 오해한다.
    await playAndSettle()

    const samples = sources[0].buffer!.getChannelData(0)
    let firstAudible = 0
    while (firstAudible < samples.length && Math.abs(samples[firstAudible]) < 0.001) {
      firstAudible += 1
    }
    // 잘라냈다면 시작 직후부터 소리가 있다. 무음이 남아 있으면 630ms 뒤에야 소리가 나온다.
    expect(firstAudible).toBeLessThan(Math.round(0.01 * SAMPLE_RATE))
  })

  it('스테레오 원본을 모노로 합친다', async () => {
    // 스테레오 원본에 pan을 걸면 "양쪽"(pan 0) 구간만 원본 정위가 그대로 남아 세 구간의
    // 음색·음량이 어긋난다. 모노로 합쳐야 세 구간이 같은 소리가 되고 위치만 달라진다.
    await playAndSettle()

    for (const source of sources) {
      expect(source.buffer!.numberOfChannels).toBe(1)
    }
    // 세 구간이 같은 버퍼를 쓴다 — 구간마다 다르게 다듬으면 비교가 무의미해진다.
    expect(new Set(sources.map((source) => source.buffer)).size).toBe(1)
  })

  it('음량을 목표 최고점으로 정규화한다', async () => {
    // 음원을 바꿨을 때 녹음 레벨에 따라 음량이 들쭉날쭉하지 않게 고정한다.
    await playAndSettle()

    const samples = sources[0].buffer!.getChannelData(0)
    let peak = 0
    for (const value of samples) peak = Math.max(peak, Math.abs(value))
    expect(peak).toBeCloseTo(0.7, 2)
    expect(peak).toBeLessThan(1)   // 클리핑 헤드룸이 남는다
  })

  it('여운이 구간 길이를 넘지 않게 자른다', async () => {
    // 원본 소리는 1.8초인데 구간은 1.55초다. 넘치면 다음 구간과 겹쳐 좌우 판단이 흐려진다.
    await playAndSettle()

    for (const [index, source] of sources.entries()) {
      const limit = SPEAKER_TEST_STEPS[index].durationMs / 1000
      expect(source.buffer!.duration).toBeLessThanOrEqual(limit)
      // 예약 시각은 초 단위 부동소수 연산으로 나오므로 1ms 여유를 둔다. 실제 겹침은
      // "구간이 겹치지 않게 재생한다"가 startAt > 이전 stopAt 으로 따로 잡는다.
      expect(source.stopAt! - source.startAt).toBeLessThanOrEqual(limit + 0.001)
    }
  })

  it('구간 끝을 페이드아웃으로 닫는다', async () => {
    // 감쇠 도중 뚝 끊으면 '툭' 하는 클릭음이 테스트음보다 크게 들린다.
    await playAndSettle()

    for (const source of sources) {
      const last = source.gainEvents[source.gainEvents.length - 1]
      expect(last.kind).toBe('ramp')
      expect(last.value).toBe(0)
      // 페이드는 구간 끝에서 끝난다.
      expect(last.at).toBeCloseTo(source.startAt + source.buffer!.duration, 5)
      const fadeStart = source.gainEvents[source.gainEvents.length - 2]
      expect(fadeStart.at).toBeLessThan(last.at)
    }
  })

  it('구간이 시작될 때 채널을 알리고 끝나면 종료를 알린다', async () => {
    const onStep = vi.fn()
    const onEnd = vi.fn()

    await playAndSettle({ onStep, onEnd })

    vi.advanceTimersByTime(SPEAKER_TEST_DURATION_MS)
    expect(onStep.mock.calls.map(([channel]) => channel)).toEqual(['left', 'right', 'both'])
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('음원이 준비되기 전에는 표시를 시작하지 않는다', () => {
    // 먼저 타이머를 걸면 느린 회선에서 화면은 "양쪽 재생 중"인데 소리는 아직 왼쪽인 상태가 된다.
    const onStep = vi.fn()

    playSpeakerTest({ onStep })       // 일부러 흘리지 않는다(로드 미완 상태)
    vi.advanceTimersByTime(10_000)

    expect(onStep).not.toHaveBeenCalled()
  })

  it('중단하면 남은 음과 알림을 모두 끊는다', async () => {
    const onStep = vi.fn()
    const onEnd = vi.fn()

    const stop = await playAndSettle({ onStep, onEnd })
    stop()
    vi.advanceTimersByTime(SPEAKER_TEST_DURATION_MS)

    // 다시 듣기로 겹쳐 울리거나, 화면을 떠난 뒤 소리가 남으면 안 된다.
    expect(onStep).not.toHaveBeenCalled()
    expect(onEnd).not.toHaveBeenCalled()
    expect(sources.every((source) => source.stopAt !== null)).toBe(true)
    expect(closed).toBe(true)
  })

  it('로드가 끝나기 전에 중단하면 아무것도 예약하지 않는다', async () => {
    // 화면을 바로 떠나는 경우. 예약이 남으면 다음 화면에서 소리가 튀어나온다.
    const onEnd = vi.fn()

    const stop = playSpeakerTest({ onEnd })
    stop()
    await settle()
    vi.advanceTimersByTime(SPEAKER_TEST_DURATION_MS)

    expect(sources).toHaveLength(0)
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('음원을 한 번만 받아 다시 듣기에 재사용한다', async () => {
    // 다시 듣기마다 내려받으면 재생이 늦게 시작된다.
    await playAndSettle()
    await playAndSettle()

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
    // 디코딩은 재생마다 한다 — AudioBuffer는 컨텍스트 샘플레이트에 묶이기 때문이다.
    expect(decodeCalls).toBe(2)
    // 두 번째 재생도 실제로 예약됐다(사본을 넘기지 않아 detach 되면 여기서 깨진다).
    expect(sources).toHaveLength(SPEAKER_TEST_STEPS.length * 2)
  })

  it('미리 받아 두기는 여러 번 불러도 한 번만 요청한다', () => {
    prefetchSpeakerTestChime()
    prefetchSpeakerTestChime()

    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)
  })

  it('재생 시 컨텍스트를 깨운다', async () => {
    // 탭이 백그라운드였다면 컨텍스트가 suspended로 남아 소리가 안 난다.
    await playAndSettle()

    expect(resumed).toBeGreaterThan(0)
  })

  it('StereoPanner가 없는 브라우저에서도 소리는 난다', async () => {
    // 좌우 분리는 포기하되 "들리는지" 확인은 남긴다.
    stereoPannerAvailable = false
    const onEnd = vi.fn()

    await playAndSettle({ onEnd })
    vi.advanceTimersByTime(SPEAKER_TEST_DURATION_MS)

    expect(sources).toHaveLength(SPEAKER_TEST_STEPS.length)
    expect(pans).toEqual([])
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('음원을 못 받아도 화면 흐름은 멈추지 않는다', async () => {
    // 소리를 못 내는 환경에서 '재생 중'에 갇히면 학생이 입장 자체를 못 한다.
    fetchShouldFail = true
    const onStep = vi.fn()
    const onEnd = vi.fn()

    await playAndSettle({ onStep, onEnd })
    vi.advanceTimersByTime(SPEAKER_TEST_DURATION_MS)

    expect(sources).toHaveLength(0)
    expect(onStep.mock.calls.map(([channel]) => channel)).toEqual(['left', 'right', 'both'])
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('디코딩에 실패해도 화면 흐름은 멈추지 않는다', async () => {
    decodeShouldFail = true
    const onEnd = vi.fn()

    await playAndSettle({ onEnd })
    vi.advanceTimersByTime(SPEAKER_TEST_DURATION_MS)

    expect(sources).toHaveLength(0)
    expect(onEnd).toHaveBeenCalledTimes(1)
  })

  it('Web Audio가 없어도 화면 흐름은 멈추지 않는다', () => {
    vi.stubGlobal('AudioContext', undefined)
    const onEnd = vi.fn()

    playSpeakerTest({ onEnd })
    vi.advanceTimersByTime(SPEAKER_TEST_DURATION_MS)

    expect(onEnd).toHaveBeenCalledTimes(1)
  })
})
