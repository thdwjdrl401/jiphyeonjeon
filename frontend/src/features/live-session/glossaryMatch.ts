import type { CaptionTermReference } from './liveSessionService.interface'

/**
 * 자막 한 줄에서 용어집 단어를 찾는다.
 *
 * <p><b>서버가 하지 않는다.</b> 자막은 WebSocket으로 실시간으로 도착하고 화면은 용어집을 이미 들고
 * 있으므로 도착한 줄에서 찾는 편이 짧다. 서버가 하면 자막마다 왕복이 생기고, 강사가 용어를 고쳤을 때
 * 이미 그려진 자막을 다시 계산해야 한다.
 *
 * <p><b>대소문자·띄어쓰기를 무시한다.</b> STT가 "SecurityContext"를 "security context"로 적거나
 * "시큐리티 컨텍스트"처럼 띄어 쓰는 일이 흔하다. 글자 사이에 공백이 들어갈 수 있는 패턴으로 찾는다.
 */
export interface GlossaryEntry {
  termId: string
  term: string
}

const ESCAPE = /[.*+?^${}()|[\]\\]/g

/**
 * 용어 하나를 "띄어쓰기 무시" 정규식으로 바꾼다.
 *
 * <p>공백을 뺀 글자들 사이에 `\s*`를 끼운다 — "Security Context"도 "SecurityContext"도 같은 패턴에
 * 걸린다. 정규식 특수문자는 이스케이프한다(C++ 같은 용어가 패턴을 깨뜨리지 않게).
 */
function toPattern(term: string): RegExp | null {
  const chars = [...term.replace(/\s+/g, '')]
  if (chars.length === 0) return null
  return new RegExp(chars.map((c) => c.replace(ESCAPE, '\\$&')).join('\\s*'), 'gi')
}

/**
 * 겹치는 매칭은 <b>먼저 시작한 것</b>이 이기고, 같은 자리면 <b>긴 것</b>이 이긴다.
 * "Security"와 "SecurityContext"가 둘 다 용어일 때 긴 쪽을 고른다 — 짧은 쪽을 고르면 나머지 글자가
 * 링크 밖으로 떨어져 나온다.
 */
export function findGlossaryTerms(text: string, entries: GlossaryEntry[]): CaptionTermReference[] {
  if (!text || entries.length === 0) return []

  const found: CaptionTermReference[] = []
  for (const entry of entries) {
    const pattern = toPattern(entry.term)
    if (!pattern) continue
    for (const match of text.matchAll(pattern)) {
      if (match.index === undefined || match[0].length === 0) continue
      found.push({ termId: entry.termId, startIndex: match.index, endIndex: match.index + match[0].length })
    }
  }

  found.sort((a, b) => a.startIndex - b.startIndex
    || (b.endIndex - b.startIndex) - (a.endIndex - a.startIndex))

  const kept: CaptionTermReference[] = []
  for (const reference of found) {
    const last = kept[kept.length - 1]
    if (last && reference.startIndex < last.endIndex) continue   // 앞 매칭과 겹친다
    kept.push(reference)
  }
  return kept
}
