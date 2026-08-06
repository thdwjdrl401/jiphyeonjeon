import { describe, expect, it } from 'vitest'
import {
  clampOffset,
  coverScale,
  cropOutputSize,
  displaySize,
  frameSizeFor,
  toSourceRect,
  THUMBNAIL_ASPECT_RATIO,
} from '@/features/curriculum/thumbnailCrop'

/**
 * 대표 이미지 크롭 계산.
 *
 * <p>지키려는 것은 셋이다 — <b>틀에 빈 자리가 생기지 않는가</b>(빈 띠가 저장되면 카드가 깨진다),
 * <b>고른 자리가 원본 좌표로 정확히 옮겨지는가</b>(화면에서 본 범위와 저장되는 범위가 같아야 한다),
 * <b>원본보다 크게 저장하지 않는가</b>.
 *
 * <p>그리기(canvas)는 jsdom에 없어서 검증하지 않는다. 그래서 계산을 이 순수 함수들로 빼 두었다.
 */
describe('대표 이미지 크롭 계산', () => {
  const frame = frameSizeFor(496)

  it('16:9 틀을 폭에서 계산한다', () => {
    expect(frame.width / frame.height).toBeCloseTo(THUMBNAIL_ASPECT_RATIO, 2)
    expect(frameSizeFor(1600)).toEqual({ width: 1600, height: 900 })
  })

  /** cover 배율보다 작게 두면 틀에 빈 자리가 생긴다 — 그래서 확대는 이 값의 배수로만 다룬다. */
  it('가로로 긴 원본은 높이 기준으로, 세로로 긴 원본은 폭 기준으로 채운다', () => {
    // 2:1 원본은 틀보다 납작하다 → 높이를 채워야 빈 자리가 없다.
    expect(coverScale({ width: 2000, height: 1000 }, frame)).toBeCloseTo(frame.height / 1000, 5)
    // 2:3 원본은 틀보다 길다 → 폭을 채운다.
    expect(coverScale({ width: 1000, height: 1500 }, frame)).toBeCloseTo(frame.width / 1000, 5)
  })

  it('확대해도 틀 밖으로 끌 수 없다', () => {
    const natural = { width: 1170, height: 1170 }
    const display = displaySize(natural, frame, 1)

    // 오른쪽·아래로 끌면 이미지 좌상단이 틀 안으로 들어와 빈 자리가 생긴다 → 0으로 막는다.
    expect(clampOffset(display, frame, { x: 40, y: 40 })).toEqual({ x: 0, y: 0 })
    // 왼쪽·위로 지나치게 끌면 이미지 우하단이 틀 안으로 들어온다 → 그 한계에서 멈춘다.
    expect(clampOffset(display, frame, { x: -99999, y: -99999 })).toEqual({
      x: frame.width - display.width,
      y: frame.height - display.height,
    })
  })

  /**
   * 실제로 올라온 썸네일이 1170×1170 정방형이었다. 16:9 틀은 그보다 납작해서 <b>위아래가</b>
   * 잘린다 — 상세 히어로 슬롯(약 1.1:1)에서 좌우가 잘리는 것과 방향이 반대다. 즉 정방형 사진은
   * 크롭에서 위아래, 히어로에서 좌우가 각각 잘린다.
   */
  it('정방형 원본을 1배로 담으면 위아래가 잘리고 좌우는 온전히 남는다', () => {
    const natural = { width: 1170, height: 1170 }
    const display = displaySize(natural, frame, 1)
    const centered = clampOffset(display, frame, {
      x: (frame.width - display.width) / 2,
      y: (frame.height - display.height) / 2,
    })

    const source = toSourceRect(natural, frame, 1, centered)

    // 폭을 채우는 배율이므로 가로는 전부 보이고, 세로는 16:9만큼만 남는다.
    expect(source.sw).toBeCloseTo(natural.width, 1)
    expect(source.sx).toBeCloseTo(0, 5)
    expect(source.sw / source.sh).toBeCloseTo(THUMBNAIL_ASPECT_RATIO, 2)
    // 가운데를 보여 주므로 위아래가 같은 양만큼 잘린다.
    expect(source.sy).toBeCloseTo((natural.height - source.sh) / 2, 1)
  })

  it('끌어서 맞춘 자리가 원본 좌표로 옮겨진다', () => {
    const natural = { width: 2000, height: 1000 }
    const display = displaySize(natural, frame, 1)

    // 왼쪽 끝을 보여 주는 상태(이동량 0)면 원본도 왼쪽 끝(sx=0)에서 시작한다.
    expect(toSourceRect(natural, frame, 1, { x: 0, y: 0 }).sx).toBeCloseTo(0, 5)
    // 끝까지 끌면 원본의 오른쪽 끝이 잡힌다.
    const end = toSourceRect(natural, frame, 1, { x: frame.width - display.width, y: 0 })
    expect(end.sx + end.sw).toBeCloseTo(natural.width, 1)
  })

  it('확대하면 잘라 내는 원본 범위가 좁아진다', () => {
    const natural = { width: 2000, height: 1000 }
    const at1x = toSourceRect(natural, frame, 1, { x: 0, y: 0 })
    const at2x = toSourceRect(natural, frame, 2, { x: 0, y: 0 })

    expect(at2x.sw).toBeCloseTo(at1x.sw / 2, 1)
    expect(at2x.sh).toBeCloseTo(at1x.sh / 2, 1)
  })

  it('원본보다 크게 저장하지 않고 비율은 16:9로 맞춘다', () => {
    // 작은 원본: 잘라 낸 폭(=원본 폭)을 넘겨 늘리지 않는다.
    const small = cropOutputSize({ sx: 0, sy: 0, sw: 640, sh: 360 })
    expect(small).toEqual({ width: 640, height: 360 })

    // 큰 원본: 상한에서 멈춘다.
    const large = cropOutputSize({ sx: 0, sy: 0, sw: 4000, sh: 2250 })
    expect(large.width).toBe(1600)
    expect(large.width / large.height).toBeCloseTo(THUMBNAIL_ASPECT_RATIO, 2)
  })

  it('원본이 없거나 찌그러진 값이 들어와도 계산이 깨지지 않는다', () => {
    expect(coverScale({ width: 0, height: 0 }, frame)).toBe(1)
    expect(cropOutputSize({ sx: 0, sy: 0, sw: 0, sh: 0 }).width).toBeGreaterThan(0)
  })
})
