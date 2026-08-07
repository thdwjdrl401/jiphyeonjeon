import { describe, expect, it } from 'vitest'
import {
  CEIL_DBFS,
  FLOOR_DBFS,
  SPEAKING_LEVEL,
  decayLevel,
  levelFromRms,
  rmsOf,
} from '@/features/live-session/micLevel'
import { SEGMENTS } from '@/features/live-session/MicrophoneLevelMeter'

/** dBFS를 그 세기의 RMS로. 테스트가 "몇 dB짜리 소리"로 말할 수 있게 한다. */
function rmsAt(dbfs: number) {
  return 10 ** (dbfs / 20)
}

describe('마이크 입력 세기', () => {
  it('무음은 0이다', () => {
    expect(rmsOf(new Float32Array(64))).toBe(0)
    expect(levelFromRms(0)).toBe(0)
  })

  it('진폭이 클수록 RMS가 크다', () => {
    const quiet = rmsOf([0.01, -0.01, 0.01, -0.01])
    const loud = rmsOf([0.5, -0.5, 0.5, -0.5])
    expect(quiet).toBeCloseTo(0.01, 5)
    expect(loud).toBeCloseTo(0.5, 5)
  })

  it('바닥과 천장 밖은 잘라 낸다', () => {
    expect(levelFromRms(rmsAt(FLOOR_DBFS - 20))).toBe(0)
    expect(levelFromRms(rmsAt(CEIL_DBFS + 20))).toBe(1)
    expect(levelFromRms(rmsAt(FLOOR_DBFS))).toBeCloseTo(0, 5)
    expect(levelFromRms(rmsAt(CEIL_DBFS))).toBeCloseTo(1, 5)
  })

  /**
   * 선형으로 그리면 말소리(RMS 0.02~0.2)가 전부 게이지 바닥에 붙어, 소리가 들어오는지 눈으로
   * 구분되지 않는다. dB로 펴는 이유가 이것이다.
   */
  it('보통 말소리가 게이지의 가운데 위쪽에 온다', () => {
    const speech = levelFromRms(rmsAt(-24))
    expect(speech).toBeGreaterThan(0.6)
    expect(speech).toBeLessThan(0.9)
    // 선형이었다면 같은 소리가 바닥에 붙는다.
    expect(rmsAt(-24)).toBeLessThan(0.07)
  })

  it('조용한 방의 바닥소음으로는 "말했다"가 되지 않는다', () => {
    expect(levelFromRms(rmsAt(-55))).toBeLessThan(SPEAKING_LEVEL)
    expect(levelFromRms(rmsAt(-50))).toBeLessThan(SPEAKING_LEVEL)
    // 시끄러운 방(-45)도 통과하면 안 된다. 예전 눈금은 -48에서 이미 통과했다.
    expect(levelFromRms(rmsAt(-45))).toBeLessThan(SPEAKING_LEVEL)
    // 작게 말해도 통과해야 한다.
    expect(levelFromRms(rmsAt(-40))).toBeGreaterThan(SPEAKING_LEVEL)
  })

  /**
   * <b>아무도 말하지 않을 때 게이지가 살아 있으면 안 된다.</b> 예전에는 바닥이 -60이라 방 소음
   * -50만으로 눈금이 0.2를 넘었고(14칸 중 3칸), 그 상태로는 "지금 소리가 들어오는가"를 읽을 수 없었다.
   */
  it('조용한 방에서는 게이지가 켜지지 않는다', () => {
    expect(levelFromRms(rmsAt(-50))).toBe(0)
    expect(levelFromRms(rmsAt(-55))).toBe(0)
    // 시끄러운 방이라도 한 줌만 켜진다.
    expect(levelFromRms(rmsAt(-45))).toBeLessThan(0.15)
  })

  /**
   * 한 칸의 해상도. 범위(FLOOR~CEIL)를 칸 수로 나눈 값이고, 계측기가 흔히 쓰는 1~3 dB 안에 있어야
   * 목소리를 조금 키운 것이 눈에 보인다.
   */
  it('한 칸이 1~3 dB 사이다', () => {
    const perSegment = (CEIL_DBFS - FLOOR_DBFS) / SEGMENTS
    expect(perSegment).toBeGreaterThanOrEqual(1)
    expect(perSegment).toBeLessThanOrEqual(3)
  })

  describe('게이지 감쇠', () => {
    it('오를 때는 즉시 따라간다', () => {
      expect(decayLevel(0.1, 0.9)).toBe(0.9)
    })

    /** 말의 사이사이에 게이지가 바닥까지 떨어지면 심하게 깜빡인다. */
    it('내릴 때는 한 프레임에 정해진 만큼만 내린다', () => {
      expect(decayLevel(0.9, 0, 0.06)).toBeCloseTo(0.84, 5)
      expect(decayLevel(0.03, 0, 0.06)).toBe(0)
    })

    it('측정값 아래로는 내려가지 않는다', () => {
      expect(decayLevel(0.5, 0.48, 0.06)).toBe(0.48)
    })
  })
})
