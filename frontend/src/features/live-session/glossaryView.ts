import type { GlossaryTermView } from './liveLearningPreview'
import { findGlossaryTerms } from './glossaryMatch'
import type { CaptionView, GlossaryTerm } from './liveSessionService.interface'

/**
 * 용어집을 자막에 연결한다.
 *
 * <p>자막마다 용어 위치를 찾아 링크를 걸 수 있게 하고, 동시에 <b>몇 번 나왔는지</b>를 센다 —
 * 용어집 탭이 "이 강의에서 8번 언급"을 보여주는 값이다. 자막을 어차피 한 번 훑으므로 따로 셀 이유가 없다.
 *
 * <p>라이브·다시보기가 같은 함수를 쓴다. 두 화면이 다른 규칙으로 찾으면 같은 강의에서 링크가 다르게 걸린다.
 */
export interface GlossaryAttachment {
  captions: CaptionView[]
  terms: GlossaryTermView[]
}

export const SOURCE_LABEL: Record<GlossaryTerm['source'], string> = {
  MATERIAL: '자료에서 추출',
  INSTRUCTOR: '강사 등록',
}

export function attachGlossary(captions: CaptionView[], glossary: GlossaryTerm[]): GlossaryAttachment {
  if (glossary.length === 0) {
    // 용어가 없으면 자막을 새로 만들지 않는다 — 참조 동일성이 깨지면 목록이 통째로 다시 그려진다.
    return { captions, terms: [] }
  }

  const entries = glossary.map((term) => ({ termId: term.termId, term: term.term }))
  const occurrences = new Map<string, number>()

  const linked = captions.map((caption) => {
    const references = findGlossaryTerms(caption.text, entries)
    for (const reference of references) {
      occurrences.set(reference.termId, (occurrences.get(reference.termId) ?? 0) + 1)
    }
    return references.length === 0 ? caption : { ...caption, termReferences: references }
  })

  return {
    captions: linked,
    terms: glossary.map((term) => ({
      termId: term.termId,
      term: term.term,
      description: term.definition,
      source: term.source,
      sourceLabel: SOURCE_LABEL[term.source] ?? '자료에서 추출',
      // 별칭은 두지 않는다 — 다른 이름으로 부르고 싶으면 강사가 그 이름으로 용어를 하나 더 넣는다.
      aliases: [],
      occurrenceCount: occurrences.get(term.termId) ?? 0,
    })),
  }
}
