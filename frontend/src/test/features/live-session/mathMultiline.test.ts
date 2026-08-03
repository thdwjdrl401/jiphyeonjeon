import { describe, expect, it } from 'vitest'
import { wrapMultiline } from '@/features/live-session/mathRuntime'

/**
 * 여러 줄로 쓴 풀이가 여러 줄로 그려지는가.
 *
 * MathJax는 최상위 `\\`를 줄바꿈으로 보지 않아, 세 줄로 푼 풀이가 한 줄로 이어져 나왔다.
 * 풀이의 단계가 사라지면 판서로서 쓸모가 준다.
 */
describe('wrapMultiline', () => {
  it('한 줄 수식은 손대지 않는다', () => {
    expect(wrapMultiline('y = ax^2 + bx + c')).toBe('y = ax^2 + bx + c')
  })

  it('줄이 나뉘어 있으면 줄바꿈이 가능한 환경으로 감싼다', () => {
    // 감싸지 않으면 MathJax가 `\\`를 무시해 한 줄로 이어 그린다.
    expect(wrapMultiline('a = b \\\\ c = d')).toBe('\\displaylines{a = b \\\\ c = d}')
  })

  it('정렬 기호가 있으면 그 자리를 세로로 맞춰 주는 환경을 쓴다', () => {
    // 강사가 등호를 맞춰 쓴 풀이다. displaylines로 감싸면 맞춰 쓴 의미가 사라진다.
    expect(wrapMultiline('x &= 1 \\\\ y &= 2')).toBe('\\begin{aligned}x &= 1 \\\\ y &= 2\\end{aligned}')
  })

  it('이미 환경이 있으면 한 번 더 감싸지 않는다', () => {
    // 이중으로 감싸면 안쪽 정렬이 깨진다.
    const cases = '\\begin{cases} x = 1 \\\\ x = 2 \\end{cases}'
    expect(wrapMultiline(cases)).toBe(cases)
  })

  it('끝에 남은 줄 나눔은 빈 줄을 만들지 않는다', () => {
    expect(wrapMultiline('a = b \\\\ c = d \\\\')).toBe('\\displaylines{a = b \\\\ c = d}')
    expect(wrapMultiline('a = b \\\\  ')).toBe('\\displaylines{a = b}')
  })

  it('이스케이프된 &는 정렬 기호가 아니다', () => {
    // `\&`는 글자 그대로의 & 이므로 aligned를 부르면 안 된다.
    expect(wrapMultiline('a \\& b \\\\ c')).toBe('\\displaylines{a \\& b \\\\ c}')
  })
})
