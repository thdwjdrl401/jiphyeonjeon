import { describe, expect, it } from 'vitest'
import { findGlossaryTerms } from '@/features/live-session/glossaryMatch'

const terms = [
  { termId: 'SecurityContext', term: 'SecurityContext' },
  { termId: 'Security', term: 'Security' },
  { termId: 'C++', term: 'C++' },
]

describe('자막에서 용어 찾기', () => {
  it('대소문자를 무시한다', () => {
    const found = findGlossaryTerms('securitycontext에 담긴다', terms)
    expect(found).toEqual([{ termId: 'SecurityContext', startIndex: 0, endIndex: 15 }])
  })

  it('띄어쓰기를 무시한다 — STT가 띄어 적는 일이 흔하다', () => {
    const found = findGlossaryTerms('Security Context를 본다', terms)
    expect(found[0].termId).toBe('SecurityContext')
    expect('Security Context를 본다'.slice(found[0].startIndex, found[0].endIndex))
      .toBe('Security Context')
  })

  it('겹치면 긴 용어가 이긴다 — 짧은 쪽을 고르면 나머지가 링크 밖으로 떨어진다', () => {
    const found = findGlossaryTerms('SecurityContext', terms)
    expect(found).toHaveLength(1)
    expect(found[0].termId).toBe('SecurityContext')
  })

  it('한 줄에 여러 번 나오면 전부 찾는다', () => {
    const found = findGlossaryTerms('Security는 Security다', [{ termId: 'Security', term: 'Security' }])
    expect(found).toHaveLength(2)
  })

  it('정규식 특수문자가 든 용어도 그대로 찾는다', () => {
    const found = findGlossaryTerms('C++로 짠다', terms)
    expect(found[0].termId).toBe('C++')
  })

  it('용어집이 비었거나 자막이 비면 아무것도 찾지 않는다', () => {
    expect(findGlossaryTerms('SecurityContext', [])).toEqual([])
    expect(findGlossaryTerms('', terms)).toEqual([])
  })

  it('없는 용어를 지어내지 않는다', () => {
    expect(findGlossaryTerms('오늘은 날씨가 좋다', terms)).toEqual([])
  })
})
