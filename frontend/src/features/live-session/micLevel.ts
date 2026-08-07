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
 * <p>조용한 방의 바닥소음이 대략 -60~-50 dBFS다. 바닥을 여기 두면 아무 말 없을 때 게이지가 미세하게
 * 떨리지 않는다.
 */
export const FLOOR_DBFS = -60

/** 눈금 천장. 보통 말소리가 이 언저리라, 평소 목소리로 게이지가 거의 끝까지 찬다. */
export const CEIL_DBFS = -12

/**
 * "말했다"고 볼 눈금.
 *
 * <p>바닥소음과 말소리 사이에 둔다. 너무 낮으면 에어컨 소리에 통과하고, 너무 높으면 목소리가 작은
 * 강사가 소리쳐야 한다.
 */
export const SPEAKING_LEVEL = 0.25

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
 */
export function levelFromRms(rms: number): number {
  if (!(rms > 0)) return 0
  const dbfs = 20 * Math.log10(rms)
  const level = (dbfs - FLOOR_DBFS) / (CEIL_DBFS - FLOOR_DBFS)
  return Math.min(1, Math.max(0, level))
}

/**
 * 다음 프레임에 그릴 눈금. <b>빠르게 오르고 천천히 내린다.</b>
 *
 * <p>둘을 같은 속도로 두면 말의 자연스러운 사이사이에 게이지가 바닥까지 떨어져 심하게 깜빡인다.
 * 계측기가 예로부터 쓰는 방식이고, 사람이 "지금 소리가 들어오고 있다"를 읽어 내기에도 이쪽이 낫다.
 */
export function decayLevel(previous: number, measured: number, fallPerFrame = 0.06): number {
  return measured >= previous ? measured : Math.max(measured, previous - fallPerFrame)
}
