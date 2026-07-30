import chimeUrl from '@/assets/audio/bing-bong-subway-chime-jam-fx.mp3'

/**
 * 입장 전 점검의 스피커 테스트음. 지하철 안내음 계열의 "bing–bong" 2음 차임 음원을 재생한다.
 *
 * 좌 → 우 → 양쪽 3단으로 재생한다. 한쪽만 울리는 구간이 있어야 학생이 "한쪽 스피커가 죽었다"·
 * "좌우가 뒤바뀌었다"를 스스로 알아챌 수 있다. 예전에는 중앙에서 1초 미만 삐 소리 한 번이라,
 * 소리가 났는지조차 확신하기 어렵고 좌우는 확인할 수 없었다.
 *
 * **음원은 `assets/audio`의 MP3를 그대로 쓴다**(Web Audio 합성이 아니다). 예전엔 사인파 하나를
 * 구간 내내 일정 음량으로 끌어서(attack → 유지 → release) 전자 부저처럼 거칠게 들렸다.
 * 반복해서 듣는 화면이라 그 자극이 그대로 피로가 된다.
 *
 * <p>원본을 그대로 재생하지 않고 로드 시점에 두 가지를 손본다. 둘 다 원본을 실측해서 나온 것이다.
 *
 * 1. **앞쪽 무음을 잘라낸다.** 원본은 앞에 630ms의 무음이 있다. 그대로 재생하면 화면의
 *    "왼쪽 재생 중" 표시가 소리보다 630ms 먼저 켜져, 학생이 "왼쪽은 안 들렸다"고 오해한다.
 * 2. **모노로 합친다.** 원본은 좌우 상관계수 0.95의 스테레오다(R이 L보다 에너지가 크다).
 *    스테레오 원본에 pan을 걸면 `pan: 0`(양쪽) 구간만 원본 정위가 그대로 남아 세 구간의 음색·
 *    음량이 어긋난다. 모노로 합치고 pan을 걸면 세 구간이 같은 소리가 되고 위치만 달라진다.
 *
 * 음원 자체는 건드리지 않는다 — 파일은 받은 그대로이고(출처 추적 가능), 다듬는 규칙만 코드에 있다.
 */

export type SpeakerTestChannel = 'left' | 'right' | 'both'

export interface SpeakerTestStep {
  channel: SpeakerTestChannel
  /** 테스트 시작 기준 오프셋(ms). */
  startMs: number
  /** 소리가 나는 길이(ms). */
  durationMs: number
}

/**
 * 한 구간이 울리는 길이.
 *
 * <p>원본을 실측해 정했다 — "bing"과 "bong"의 타격 간격이 575ms이고, 두 번째 음의 감쇠가
 * 최고점 대비 -30dB까지 떨어지는 데 소리 시작부터 1,505ms가 걸린다. 그보다 짧게 자르면
 * "bong"이 잘려 2음 차임이 아니라 토막난 소리로 들린다.
 */
const STEP_DURATION_MS = 1_550
/** 구간 사이 침묵. 붙어 있으면 좌우가 어디서 바뀌었는지 알기 어렵다. */
const STEP_GAP_MS = 200

export const SPEAKER_TEST_STEPS: readonly SpeakerTestStep[] = (
  ['left', 'right', 'both'] as const
).map((channel, index) => ({
  channel,
  startMs: index * (STEP_DURATION_MS + STEP_GAP_MS),
  durationMs: STEP_DURATION_MS,
}))

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

/**
 * 정규화 목표 최고점. 음원이 바뀌어도 음량이 들쭉날쭉하지 않게 최고점을 여기에 맞춘다.
 * 1.0에서 여유를 두는 이유는 브라우저·기기 단계에서 더해지는 처리로 클리핑이 나지 않게 하기 위함이다.
 */
const TARGET_PEAK = 0.7
/** 이 값(최고점 대비)을 넘는 첫 샘플을 "소리의 시작"으로 본다. 앞쪽 무음을 잘라내는 기준. */
const SILENCE_THRESHOLD = 0.01
/** 구간 끝 페이드아웃. 감쇠 도중 뚝 끊으면 '툭' 하는 클릭음이 테스트음보다 크게 들린다. */
const FADE_OUT_SEC = 0.12
/** 스케줄 여유. 0으로 두면 첫 음의 시작이 잘린다. */
const SCHEDULE_LEAD_SEC = 0.05

interface PlaySpeakerTestOptions {
  /** 각 구간이 시작될 때 어느 채널인지 알린다(화면 표시를 소리와 맞추기 위함). */
  onStep?: (channel: SpeakerTestChannel) => void
  /** 마지막 구간까지 끝났을 때. */
  onEnd?: () => void
}

function audioContextConstructor(): typeof AudioContext | undefined {
  return window.AudioContext
    ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
}

function createAudioContext(): AudioContext | null {
  const AudioCtx = audioContextConstructor()
  return AudioCtx ? new AudioCtx() : null
}

/**
 * 인코딩된 음원을 모듈 수준에서 한 번만 받아 둔다.
 *
 * "다시 듣기"를 누를 때마다 다시 내려받으면 재생이 늦게 시작된다. 디코딩된 `AudioBuffer`가 아니라
 * **인코딩된 바이트를 캐시하는 이유**: `AudioBuffer`는 만들어진 `AudioContext`의 샘플레이트에
 * 묶인다. 재생마다 새 컨텍스트를 만드는 구조에서 재사용하면 샘플레이트가 다른 기기에서 음이
 * 빨라지거나 느려진다. `decodeAudioData`에 매번 맡기면 컨텍스트 샘플레이트로 리샘플링해 준다.
 */
let encodedChime: Promise<ArrayBuffer | null> | null = null

function fetchChime(): Promise<ArrayBuffer | null> {
  encodedChime ??= fetch(chimeUrl)
    .then((response) => (response.ok ? response.arrayBuffer() : null))
    .catch(() => null)
  return encodedChime
}

/**
 * 음원을 미리 받아 둔다. 입장 전 점검 화면에 들어오면 호출한다 — 버튼을 누른 뒤에 내려받기
 * 시작하면 느린 회선에서 "재생 중"인데 소리가 안 나는 구간이 생긴다.
 *
 * Web Audio가 없는 환경에서는 받지 않는다. 재생할 수 없는 파일을 내려받는 건 낭비이고,
 * 그런 환경(구형 브라우저·jsdom 등)에서 굳이 네트워크를 건드릴 이유가 없다.
 */
export function prefetchSpeakerTestChime(): void {
  if (!audioContextConstructor()) return
  void fetchChime()
}

/**
 * 디코딩된 음원을 모노로 합치고, 앞쪽 무음을 자르고, 음량을 정규화해 돌려준다.
 *
 * 무음 판정을 고정 진폭이 아니라 최고점 대비 비율로 하는 이유: 음원을 다른 파일로 바꿨을 때
 * 녹음 레벨이 달라도 같은 규칙이 통하게 하기 위함이다.
 */
function toMonoTrimmed(ctx: AudioContext, source: AudioBuffer): AudioBuffer | null {
  const frames = source.length
  const channels = source.numberOfChannels
  if (frames === 0 || channels === 0) return null

  const mono = new Float32Array(frames)
  for (let channel = 0; channel < channels; channel += 1) {
    const data = source.getChannelData(channel)
    for (let i = 0; i < frames; i += 1) mono[i] += data[i] / channels
  }

  let peak = 0
  for (let i = 0; i < frames; i += 1) peak = Math.max(peak, Math.abs(mono[i]))
  if (peak === 0) return null   // 전체가 무음인 파일 — 재생해도 의미가 없다.

  const threshold = peak * SILENCE_THRESHOLD
  let start = 0
  while (start < frames && Math.abs(mono[start]) < threshold) start += 1

  // 구간 길이만큼만 남긴다. 여운이 구간을 넘치면 다음 구간과 겹쳐 좌우 판단이 흐려진다.
  const maxFrames = Math.round((STEP_DURATION_MS / 1000) * source.sampleRate)
  const length = Math.min(frames - start, maxFrames)
  const gain = TARGET_PEAK / peak

  const trimmed = ctx.createBuffer(1, length, source.sampleRate)
  const target = trimmed.getChannelData(0)
  for (let i = 0; i < length; i += 1) target[i] = mono[start + i] * gain
  return trimmed
}

async function prepareChime(ctx: AudioContext): Promise<AudioBuffer | null> {
  const encoded = await fetchChime()
  if (!encoded) return null
  try {
    // decodeAudioData는 넘긴 ArrayBuffer를 detach 하므로 사본을 준다 — 원본을 넘기면
    // 캐시가 비워져 "다시 듣기"가 조용히 실패한다.
    const decoded = await ctx.decodeAudioData(encoded.slice(0))
    return toMonoTrimmed(ctx, decoded)
  } catch {
    return null   // 디코딩 실패(코덱 미지원·닫힌 컨텍스트). 소리는 없지만 화면 흐름은 이어진다.
  }
}

/**
 * 한 구간을 예약하고 만들어진 source를 돌려준다.
 *
 * 구간마다 panner는 하나씩 둔다 — 여러 경로로 같은 소리를 내보내면 좌우 정위가 흐려진다.
 */
function scheduleChime(
  ctx: AudioContext, buffer: AudioBuffer, step: SpeakerTestStep, startAt: number,
) {
  const source = ctx.createBufferSource()
  source.buffer = buffer

  const ring = buffer.duration
  const fadeOut = Math.min(FADE_OUT_SEC, ring / 2)
  const fade = ctx.createGain()
  fade.gain.setValueAtTime(1, startAt)
  fade.gain.setValueAtTime(1, startAt + ring - fadeOut)
  fade.gain.linearRampToValueAtTime(0, startAt + ring)

  source.connect(fade)

  // StereoPannerNode가 없는 브라우저에서는 좌우 분리를 포기하고 중앙으로 낸다 —
  // 좌우 확인은 못 하지만 "소리가 나는지"는 여전히 확인할 수 있다.
  const panner = ctx.createStereoPanner?.()
  if (panner) {
    panner.pan.value = CHANNEL_PAN[step.channel]
    fade.connect(panner)
    panner.connect(ctx.destination)
  } else {
    fade.connect(ctx.destination)
  }

  source.start(startAt)
  source.stop(startAt + ring)
  return source
}

/**
 * 테스트음을 재생하고 중단 함수를 돌려준다.
 *
 * 중단 함수는 다시 듣기·화면 이탈에서 부른다 — 이전 재생이 남아 있으면 새 재생과 겹쳐
 * 좌우 판단이 불가능해진다. 음원을 못 받거나 Web Audio를 못 쓰는 환경에서도 `onStep`·`onEnd`는
 * 그대로 흐른다(소리만 없다). 그래야 화면이 '재생 중'에서 멈추지 않는다.
 *
 * **표시 타이머를 음원 준비 뒤에 시작하는 이유**: 로드·디코딩은 비동기다. 먼저 타이머를 걸면
 * 느린 회선에서 화면은 "양쪽 재생 중"인데 소리는 아직 왼쪽인 상태가 된다.
 */
export function playSpeakerTest(options: PlaySpeakerTestOptions = {}): () => void {
  const ctx = createAudioContext()
  const sources: AudioBufferSourceNode[] = []
  const timers: number[] = []
  let stopped = false

  const startStepTimers = () => {
    if (stopped) return
    for (const step of SPEAKER_TEST_STEPS) {
      timers.push(window.setTimeout(() => options.onStep?.(step.channel), step.startMs))
    }
    timers.push(window.setTimeout(() => options.onEnd?.(), SPEAKER_TEST_DURATION_MS))
  }

  if (ctx) {
    void prepareChime(ctx).then((buffer) => {
      if (stopped) return
      if (buffer) {
        // 탭이 백그라운드였다면 컨텍스트가 suspended로 남아 있을 수 있다.
        void ctx.resume?.()
        const base = ctx.currentTime + SCHEDULE_LEAD_SEC
        for (const step of SPEAKER_TEST_STEPS) {
          sources.push(scheduleChime(ctx, buffer, step, base + step.startMs / 1000))
        }
      }
      startStepTimers()
    })
  } else {
    startStepTimers()
  }

  return () => {
    if (stopped) return
    stopped = true
    timers.forEach((timer) => window.clearTimeout(timer))
    sources.forEach((source) => {
      try {
        source.stop()
      } catch {
        // 이미 끝난 source를 다시 멈추는 건 오류가 아니다.
      }
    })
    void ctx?.close()
  }
}
