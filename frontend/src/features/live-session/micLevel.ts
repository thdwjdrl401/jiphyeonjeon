/**
 * 마이크 입력 세기를 눈금으로 옮긴다.
 *
 * <p>지금까지의 점검은 <b>트랙이 올라갔는지</b>까지만 봤다(ADR-0002 §1, ADR-0099). 그런데 마이크는
 * publish된 채로도 소리를 안 낼 수 있다 — 운영체제에서 음소거돼 있거나, 엉뚱한 입력이 잡혔거나,
 * 장치가 죽었거나. 그러면 강사는 "마이크 1개 송출"을 보고 안심한 채 무음 강의를 한다.
 *
 * <p>그 간극을 메우는 유일한 방법은 <b>실제로 들어오는 소리를 재는 것</b>이다. 강사가 한마디 하면
 * 게이지가 올라가고, 그때 비로소 "소리가 들어옵니다"라고 말할 수 있다.
 *
 * <p>계산은 순수 함수로 떼어 둔다 — Web Audio는 jsdom에 없어서, 여기 섞으면 눈금이 맞는지 시험할
 * 방법이 사라진다.
 */

/**
 * 눈금 바닥. 이보다 조용하면 0이다.
 *
 * <p><b>바닥소음보다 위에 둔다.</b> 조용한 방의 바닥소음이 대략 -60~-50 dBFS인데, 예전에는 바닥이
 * -60이라 <b>-50짜리 방 소음만으로 14칸 중 3칸이 켜졌다</b>. 아무도 말하지 않는데 게이지가 살아
 * 있으면 "지금 소리가 들어오는가"를 읽을 수 없다.
 *
 * <p>dB는 로그라 <b>바닥 근처에서 기울기가 가장 가파르다</b> — 들리지도 않는 변화가 눈금을 크게
 * 흔든다. 바닥을 올리는 것이 그 구간을 잘라 내는 유일한 방법이다.
 */
export const FLOOR_DBFS = -50

/**
 * 눈금 상한. 보통 말소리(-30~-18 dBFS)가 위쪽 절반에 오고 그 위로 여유가 남는다 — 끝 두 칸은
 * 붉게 칠해 과입력을 알린다(`mic-meter__bar i:nth-last-child(-n+2)`).
 */
export const CEIL_DBFS = -10

/**
 * "말했다"고 볼 눈금. 지금 범위에서 <b>약 -41 dBFS</b>다.
 *
 * <p>바닥소음과 말소리 사이에 둔다. 너무 낮으면 에어컨 소리에 통과하고, 너무 높으면 목소리가 작은
 * 강사가 소리쳐야 한다. 예전에는 이 값이 <b>-48 dBFS</b>여서 바닥소음 범위 안에 있었다 — 숨소리·
 * 키보드로도 "소리가 들어옵니다"가 떴다.
 */
export const SPEAKING_LEVEL = 0.22

/** 시간영역 샘플의 RMS(제곱평균제곱근). 주파수 분포와 무관한 순수 진폭이다. */
export function rmsOf(samples: Float32Array | number[]): number {
  if (samples.length === 0) return 0
  let sum = 0
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i]
  return Math.sqrt(sum / samples.length)
}

/**
 * RMS(0~1)를 게이지 눈금(0~1)으로.
 *
 * <p><b>dB로 편다.</b> 선형으로 그리면 말소리(RMS 0.02~0.2)가 게이지 바닥에 다 붙어 버려, 소리가
 * 들어오는지 안 들어오는지 눈으로 구분되지 않는다.
 *
 * <p>범위는 {@link FLOOR_DBFS}~{@link CEIL_DBFS}로 <b>40 dB</b>다. 게이지 칸 수로 나눈 값이 한 칸의
 * 해상도가 된다 — 24칸이면 한 칸에 약 1.7 dB로, 계측기가 흔히 쓰는 굵기다.
 */
export function levelFromRms(rms: number): number {
  if (!(rms > 0)) return 0
  const dbfs = 20 * Math.log10(rms)
  const level = (dbfs - FLOOR_DBFS) / (CEIL_DBFS - FLOOR_DBFS)
  return Math.min(1, Math.max(0, level))
}

/**
 * 다음 프레임에 그릴 눈금. <b>빠르게 오르고 천천히 내리되, 오를 때도 평활한다.</b>
 *
 * <p>예전에는 오를 때 <b>측정값으로 즉시 점프</b>했다. 그러면 음절 하나하나의 피크가 그대로 꼭대기를
 * 쳐서 말하는 내내 게이지가 요란하게 튄다 — 실제로 <b>소리가 너무 큰 것처럼 보였다</b>. 계측기가
 * 쓰는 방식은 그게 아니라 <b>attack·release 시간 상수</b>다.
 *
 * <p>지수 평활이라 계수가 곧 시간이다(60fps 기준):
 * <ul>
 *   <li>{@code rise 0.28} — 약 180ms에 따라붙는다. 음절이 아니라 <b>말 한 덩어리</b>의 크기를 그린다.</li>
 *   <li>{@code fall 0.06} — 약 800ms에 걸쳐 내린다. 말 사이의 짧은 쉼에 바닥까지 떨어지지 않는다.</li>
 * </ul>
 *
 * <p>내리는 쪽을 훨씬 느리게 두는 것이 핵심이다. 같은 속도면 말의 자연스러운 사이사이에 게이지가
 * 깜빡이고, 그러면 "지금 소리가 들어오고 있다"를 읽어 낼 수 없다.
 */
export function smoothLevel(previous: number, measured: number, rise = 0.28, fall = 0.06): number {
  const factor = measured > previous ? rise : fall
  return previous + (measured - previous) * factor
}
