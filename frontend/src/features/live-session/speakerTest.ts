/**
 * 입장 전 점검의 스피커 테스트음. 외부 오디오 자산 없이 Web Audio로 직접 만든다.
 *
 * 좌 → 우 → 양쪽 3단으로 약 3초간 재생한다. 한쪽만 울리는 구간이 있어야 학생이
 * "한쪽 스피커가 죽었다"·"좌우가 뒤바뀌었다"를 스스로 알아챌 수 있다. 예전에는 중앙에서
 * 1초 미만 삐 소리 한 번이라, 소리가 났는지조차 확신하기 어렵고 좌우는 확인할 수 없었다.
 *
 * 음높이를 단계마다 올리는 이유(C6→E6→G6): 화면을 보지 않아도 몇 번째 구간인지 들리고,
 * 한 구간이 빠지면 화음이 끊겨 바로 이상하게 들린다.
 *
 * **소리는 금속을 한 번 때린 맑은 차임이다** — 코인·글로켄슈필처럼 밝게 '팅' 하고 맺힌 뒤
 * 조용히 여운을 남긴다. 예전엔 사인파 하나를 구간 내내 일정 음량으로 끌어서(attack → 유지 →
 * release) 전자 부저처럼 들렸다. 반복해서 듣는 화면이라 그 자극이 그대로 피로가 된다.
 * 부저와 악기를 가르는 건 음높이가 아니라 두 가지다.
 *
 * 1. **배음 구성**(CHIME_PARTIALS) — 사인파 하나는 배음이 없어 기계음으로 들린다.
 * 2. **엔벨로프** — 악기는 때린 순간이 가장 크고 계속 잦아든다. 유지 구간을 두지 않는다.
 *
 * 음역을 한 옥타브 올린 것(C5→C6)도 의도다. 노트북 내장 스피커는 500Hz 아래를 거의 못 내서
 * C5(523Hz)는 있는 힘껏 내도 빈약하게 들리는데, C6(1046Hz)와 그 배음은 내장 스피커가 가장
 * 잘 내는 대역에 들어온다. 고역이 좌우 정위(ILD)도 더 뚜렷하게 만든다.
 *
 * 노이즈 계열은 쓰지 않는다 — 좌우 정위가 흐려지고 '쉭' 소리 자체가 거슬린다. 타격의 금속
 * 질감은 노이즈가 아니라 짧게 스치는 비정수배 배음으로 만든다(CHIME_PARTIALS 참고).
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
  { channel: 'left', startMs: 0, durationMs: 800, frequency: 1046.5 },
  { channel: 'right', startMs: 1000, durationMs: 800, frequency: 1318.51 },
  { channel: 'both', startMs: 2000, durationMs: 950, frequency: 1567.98 },
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

/**
 * 최종 음량. 배음 피크의 합이 이 값이 되도록 정규화하므로(PARTIAL_GAIN_SUM) 배음이 동시에
 * 최고점을 지나도 클리핑하지 않는다. 음량 조절은 여기 한 곳에서만 한다.
 *
 * <p>기존 부저(사인파 유지음)보다 값이 큰 이유: 감쇠음은 같은 진폭이라도 실제 에너지(RMS)가
 * 유지음의 4분의 1 수준이라, 같은 숫자를 쓰면 "소리가 작아졌다"가 된다. 확인해야 할 소리가
 * 작아지면 스피커 테스트 자체가 무의미하므로 타격 순간의 진폭을 기존 부저의 두 배 남짓으로
 * 잡았다. 그래도 정규화 덕에 실측 최고점은 0.4 아래로 헤드룸이 남는다.
 */
const PEAK_GAIN = 0.55
/** 타격의 어택. 2ms면 '팅' 하고 맺힌다. 길어지면 물렁해져 부저 쪽으로 돌아간다. */
const ATTACK_SEC = 0.002
/** exponentialRamp는 0을 못 받는다. 사실상 무음인 최소값. */
const SILENT_GAIN = 0.0001

/**
 * 감쇠를 급감 → 여운 두 단계로 꺾는 지점. 실제 금속 타격음은 때린 직후 순식간에 작아지고,
 * 그 뒤로는 작은 음량이 길게 남는다. 한 번의 exponentialRamp로 무음까지 곧장 내리면
 * dB가 일정한 속도로 떨어져 기계적으로 들린다 — 이 꺾임 하나가 "때렸다"는 인상을 만든다.
 */
const DECAY_KNEE_AT = 0.28
/** 급감이 멈추는 음량(최고점 대비). 여기서부터 조용한 여운이 남는다. */
const DECAY_KNEE_GAIN = 0.22

/**
 * 금속을 한 번 때린 소리를 만드는 배음 구성.
 *
 * <p>구성은 역할이 둘로 갈린다 — {@code decaySec}이 그 역할을 드러낸다.
 *
 * <p><b>몸통(1·2·3.01배음, 0.16초 이상 남는다)</b>: 음높이와 종 같은 밝기를 만든다. 협음
 * 관계라 여러 번 들어도 거슬리지 않는다. `3.01`처럼 정수에서 살짝 벗어난 건 완전 정수배가
 * 오르간처럼 딱 맞아떨어져 오히려 인공적으로 들리기 때문이다.
 *
 * <p><b>타격 색(2.76·5.42·8.93배음, 0.06초 안에 사라진다)</b>: 양단이 자유로운 금속 막대의
 * 실제 진동 모드비(1 : 2.76 : 5.42 : 8.93)다. 이 비정수배들이 '금속'이라는 인상을 만든다 —
 * 노이즈를 섞지 않고 금속 질감을 내는 방법이 이것이다. <b>오래 남으면 불협으로 들리므로 아주
 * 짧게 끊는다.</b> 스치듯 지나가면 불협이 아니라 때린 순간의 '틱'으로 들리고, 그래서 맑고
 * 부드러운 음색과 금속 질감을 동시에 얻는다.
 *
 * <p>이 셋의 {@code gain}이 작지 않은 이유: 처음엔 0.05~0.12로 낮게 잡았는데, 10ms 창으로
 * 타격 순간의 스펙트럼을 재 보니 고역이 전체의 4.6%밖에 안 돼 금속 질감이 사실상 들리지 않았다.
 * 0.12~0.30으로 올려 10.4%까지 맞췄다. 감쇠가 짧아서 이 정도로 올려도 여운에는 남지 않는다.
 *
 * <p><b>{@code decaySec}이 배음마다 다른 이유</b>: 배음이 전부 기본음만큼 길게 남으면 오르간
 * 화음처럼 눌린 지속음이 되어 "연속음"으로 들린다. 고역이 먼저 빠지고 기본음만 남아야 때린 뒤
 * 맑게 울리는 소리가 된다.
 */
const CHIME_PARTIALS: ReadonlyArray<{ ratio: number; gain: number; decaySec: number }> = [
  { ratio: 1, gain: 1, decaySec: 0.7 },
  { ratio: 2, gain: 0.44, decaySec: 0.32 },
  { ratio: 2.76, gain: 0.3, decaySec: 0.055 },
  { ratio: 3.01, gain: 0.24, decaySec: 0.17 },
  { ratio: 5.42, gain: 0.22, decaySec: 0.045 },
  { ratio: 8.93, gain: 0.12, decaySec: 0.025 },
]

/** 배음을 다 더해도 최종 음량이 PEAK_GAIN을 넘지 않게 정규화한다. */
const PARTIAL_GAIN_SUM = CHIME_PARTIALS.reduce((sum, partial) => sum + partial.gain, 0)

/** 여운과 다음 구간 사이에 남기는 여백. 0으로 두면 감쇠 꼬리가 다음 구간에 물린다. */
const STEP_TAIL_MARGIN_SEC = 0.03

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

/**
 * 한 구간의 차임을 예약하고, 만들어진 oscillator들을 돌려준다.
 *
 * 타격은 구간당 한 번이다. 한 구간에서 두 번 때리면(낮은음 → 높은음) 두 여운이 겹쳐
 * 두 음이 아니라 뭉개진 한 덩어리로 들린다.
 *
 * 구간마다 panner·출력 gain은 하나씩 두고 배음 oscillator들을 그 하나로 모은다 — 배음마다
 * panner를 따로 만들면 같은 소리가 여러 경로로 나가 좌우 정위가 흐려진다.
 */
function scheduleChime(ctx: AudioContext, step: SpeakerTestStep, startAt: number) {
  const output = ctx.createGain()
  output.gain.value = PEAK_GAIN

  // StereoPannerNode가 없는 브라우저에서는 좌우 분리를 포기하고 중앙으로 낸다 —
  // 좌우 확인은 못 하지만 "소리가 나는지"는 여전히 확인할 수 있다.
  const panner = ctx.createStereoPanner?.()
  if (panner) {
    panner.pan.value = CHANNEL_PAN[step.channel]
    output.connect(panner)
    panner.connect(ctx.destination)
  } else {
    output.connect(ctx.destination)
  }

  // 여운이 구간을 넘치면 다음 구간과 겹쳐 좌우 판단이 흐려진다 — 구간 안에서 끝나게 자른다.
  const maxRing = step.durationMs / 1000 - ATTACK_SEC - STEP_TAIL_MARGIN_SEC
  const struckAt = startAt + ATTACK_SEC

  return CHIME_PARTIALS.map((partial) => {
    const oscillator = ctx.createOscillator()
    const partialGain = ctx.createGain()
    const peak = partial.gain / PARTIAL_GAIN_SUM
    const decay = Math.min(partial.decaySec, maxRing)

    oscillator.type = 'sine'
    oscillator.frequency.value = step.frequency * partial.ratio

    // 타격 엔벨로프: 순간적으로 치솟고 급감한 뒤 조용히 잦아든다. 중간에 음량을 다시 고정하는
    // 유지 구간을 두지 않는 것이 부저와 악기를 가르는 핵심이다.
    // 0에서 시작하지 않는 이유는 exponentialRamp가 0을 못 받아서다.
    partialGain.gain.setValueAtTime(SILENT_GAIN, startAt)
    partialGain.gain.linearRampToValueAtTime(peak, struckAt)
    partialGain.gain.exponentialRampToValueAtTime(
      peak * DECAY_KNEE_GAIN, struckAt + decay * DECAY_KNEE_AT,
    )
    partialGain.gain.exponentialRampToValueAtTime(SILENT_GAIN, struckAt + decay)

    oscillator.connect(partialGain)
    partialGain.connect(output)
    oscillator.start(startAt)
    oscillator.stop(struckAt + decay + 0.02)
    return oscillator
  })
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
      oscillators.push(...scheduleChime(ctx, step, base + step.startMs / 1000))
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
