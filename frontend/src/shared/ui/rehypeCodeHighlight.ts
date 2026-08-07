import { createLowlight } from 'lowlight'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'

/**
 * 코드 블록 문법 강조. <b>`rehype-highlight`를 쓰지 않고 직접 붙인다.</b>
 *
 * <p>그 플러그인은 `lowlight`의 `common`(37개 언어)을 <b>무조건</b> import한다. `languages` 옵션은
 * 무엇을 <b>등록</b>할지만 정할 뿐 무엇을 <b>내려보낼지</b>는 못 정해서, 언어를 하나만 켜도 청크가
 * 똑같이 커진다 — 실측으로 gzip 47.5kB → 101.2kB였고 <b>등록 언어를 1개로 줄여도 그대로였다</b>.
 * 여기서는 고른 언어만 import하므로 청크가 실제로 그만큼만 자란다(ADR-0097).
 *
 * <p>탐색도 `unist-util-visit`를 끌어오지 않고 직접 돈다 — 우리가 찾는 것이 `pre > code` 하나뿐이라
 * 전이 의존을 직접 import하는 값이 없다.
 */

/**
 * 강조를 켤 언어. 운영 커리큘럼 44개의 제목 분포로 골랐다(Java·Spring 4 / React·JS·TS 3 /
 * Python 1 / SQL 1). 나머지 넷(`bash`·`json`·`xml`·`css`)은 어떤 수업에서든 나오고, `xml`이 HTML도
 * 맡는다. <b>등록하지 않은 언어는 강조 없이 그대로 나온다</b> — 깨지지 않는다.
 */
const lowlight = createLowlight({ bash, css, java, javascript, json, python, sql, typescript, xml })

interface HastNode {
  type: string
  tagName?: string
  value?: string
  properties?: { className?: unknown }
  children?: HastNode[]
}

/** ` ```java `가 `<code class="language-java">`로 온다. 언어를 안 밝혔으면 null이다. */
function declaredLanguage(node: HastNode): string | null {
  const className = node.properties?.className
  const names = Array.isArray(className) ? className : typeof className === 'string' ? className.split(' ') : []
  for (const name of names) {
    if (typeof name !== 'string') continue
    const match = /^(?:language|lang)-(.+)$/.exec(name)
    if (match) return match[1]
  }
  return null
}

function textOf(node: HastNode): string {
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

/**
 * `pre > code`만 강조한다. <b>언어를 밝힌 것만</b> 칠하고, 자동 감지는 하지 않는다 — 짧은 조각에서
 * 자주 틀리는데 여기는 코드를 가르치는 화면이라 <b>잘못 칠한 색이 색이 없는 것보다 나쁘다</b>.
 *
 * <p>인라인 코드(`pre` 밖의 `code`)는 건드리지 않는다. 문장 속 낱말이라 강조할 문법이 없다.
 */
export default function rehypeCodeHighlight() {
  return (tree: HastNode) => {
    walk(tree, null)
  }
}

function walk(node: HastNode, parent: HastNode | null) {
  if (node.type === 'element' && node.tagName === 'code' && parent?.tagName === 'pre') {
    const language = declaredLanguage(node)
    if (language && lowlight.registered(language)) {
      /*
       * 스트리밍 중에는 코드가 <b>덜 온 상태</b>로 들어온다 — 따옴표가 안 닫히거나 괄호가 열린 채다.
       * highlight.js는 그런 입력도 던지지 않고 최선으로 칠하지만, 혹시 터져도 답변 전체가 빈 화면이
       * 되면 안 되므로 감싼다. 실패하면 강조만 포기하고 코드는 그대로 남는다.
       */
      try {
        node.children = lowlight.highlight(language, textOf(node)).children as HastNode[]
        node.properties = { ...node.properties, className: ['hljs', `language-${language}`] }
      } catch {
        // 강조 없이 둔다.
      }
    }
    return
  }
  for (const child of node.children ?? []) walk(child, node)
}
