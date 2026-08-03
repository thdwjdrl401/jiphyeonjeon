import type { AnnotationFiles } from './annotation'

/**
 * LaTeX를 판서에 넣을 수 있는 그림으로 만든다(ADR-0054).
 *
 * <p><b>왜 글자가 아니라 그림인가.</b> Excalidraw에는 수식 렌더러가 없다. 유니코드로 옮기면
 * `ax² + bx + c` 정도는 읽히지만 분수의 가로줄이나 적분 기호의 상하 구조는 표현할 수 없다.
 *
 * <p><b>왜 SVG인가.</b> Egress는 헤드리스 Chrome이고 외부 폰트를 받지 못할 수 있다. MathJax의 SVG
 * 출력은 글리프를 `<path>`로 <b>인라인</b>하므로 폰트 없이도 같은 모양이 나온다(실측: 수식 하나
 * 6.4KB, 외부 참조 0건). `fontCache: 'none'`으로 두어 `<use>` 참조조차 남기지 않는다 — data URI로
 * 넣었을 때 조각 참조가 해석되지 않는 경우를 아예 만들지 않는다.
 *
 * <p>무겁다(수백 KB). 그래서 <b>수식을 실제로 넣을 때만</b> 지연 로드한다. 판서를 쓰지 않는 강의는
 * 물론이고 다이어그램만 쓰는 강의도 이 비용을 지불하지 않는다.
 */

type MathJaxDocument = { convert: (tex: string, options: { display: boolean }) => unknown }
type Adaptor = { innerHTML: (node: unknown) => string }

let pending: Promise<{ document: MathJaxDocument; adaptor: Adaptor }> | null = null

function loadMathJax() {
  if (!pending) {
    pending = Promise.all([
      import('mathjax-full/js/mathjax.js'),
      import('mathjax-full/js/input/tex.js'),
      import('mathjax-full/js/output/svg.js'),
      import('mathjax-full/js/adaptors/browserAdaptor.js'),
      import('mathjax-full/js/handlers/html.js'),
      import('mathjax-full/js/input/tex/AllPackages.js'),
    ]).then(([core, tex, svg, adaptors, handlers, packages]) => {
      const adaptor = adaptors.browserAdaptor()
      handlers.RegisterHTMLHandler(adaptor)
      const document = core.mathjax.document('', {
        InputJax: new tex.TeX({ packages: packages.AllPackages }),
        // 'none': 글리프를 매번 인라인한다. `<use>` 참조가 남지 않아 data URI 안에서 안전하다.
        OutputJax: new svg.SVG({ fontCache: 'none' }),
      })
      return { document: document as unknown as MathJaxDocument, adaptor: adaptor as unknown as Adaptor }
    })
  }
  return pending
}

/** 판서에 넣을 수식 그림 한 장. 크기는 Excalidraw 요소의 width/height로 그대로 쓴다. */
export interface RenderedMath {
  dataUrl: string
  width: number
  height: number
}

/** `1.5ex` 같은 값을 px로. MathJax는 글자 기준 단위로 크기를 낸다. */
function toPixels(value: string | null, exToPx: number): number {
  if (!value) return 0
  const amount = Number.parseFloat(value)
  if (!Number.isFinite(amount)) return 0
  if (value.endsWith('ex')) return amount * exToPx
  if (value.endsWith('em')) return amount * exToPx * 2
  return amount
}

/**
 * 여러 줄 수식을 MathJax가 실제로 여러 줄로 그리게 감싼다.
 *
 * <p>MathJax는 <b>최상위의 {@code \\\\}를 줄바꿈으로 보지 않는다.</b> 줄을 나누려면 그럴 수 있는
 * 환경 안에 있어야 한다. 그래서 강사가 세 줄로 푼 풀이가 한 줄로 이어져 그려졌다.
 *
 * <p>이미 환경이 있으면(`\begin{...}`) 손대지 않는다 — 그 안의 {@code \\\\}는 이미 제 뜻대로 동작하고,
 * 밖에서 한 번 더 감싸면 정렬이 깨진다.
 *
 * <p>정렬 기호(`&`)가 있으면 `aligned`를, 없으면 `\displaylines`를 쓴다. `aligned`는 `&` 자리를
 * 세로로 맞춰 주는데(강사가 등호를 맞춰 쓴 풀이가 그렇다), `&`가 없으면 전부 왼쪽으로 몰려
 * 가운데 정렬을 기대한 줄들이 어긋난다.
 */
export function wrapMultiline(latex: string): string {
  const trimmed = latex.trim()
  if (!trimmed.includes('\\\\')) return trimmed
  if (/\\begin\{/.test(trimmed)) return trimmed
  // `\\`로 끝나면 빈 줄이 하나 더 생긴다. 앞뒤 공백까지 걷어야 `{a \\ }` 같은 꼴이 남지 않는다.
  const body = trimmed.replace(/(\s*\\\\)+\s*$/, '')
  return /(^|[^\\])&/.test(body)
    ? `\\begin{aligned}${body}\\end{aligned}`
    : `\\displaylines{${body}}`
}

/**
 * LaTeX를 SVG data URI로 렌더한다.
 *
 * <p>색을 <b>명시한다.</b> MathJax는 `currentColor`로 내보내는데, data URI 안에서는 물려받을 색이
 * 없어 검게 나온다. 판서 기본색과 같아야 강사가 그린 다른 획과 따로 놀지 않는다.
 *
 * @param fontSizePx 원본 손글씨 높이에서 온 글자 크기. 결과 크기의 기준이다
 */
export async function renderMathSvg(latex: string, fontSizePx: number): Promise<RenderedMath> {
  const { document, adaptor } = await loadMathJax()
  const node = document.convert(wrapMultiline(latex), { display: true })
  let svg = adaptor.innerHTML(node)

  // `ex`는 글자 높이의 절반쯤이다. 손글씨 크기에 맞추려면 이 환산이 필요하다.
  const exToPx = fontSizePx / 2
  const width = toPixels(/width="([^"]+)"/.exec(svg)?.[1] ?? null, exToPx)
  const height = toPixels(/height="([^"]+)"/.exec(svg)?.[1] ?? null, exToPx)

  svg = svg.replace(/currentColor/g, MATH_COLOR)
  // xmlns가 없으면 data URI로 열었을 때 브라우저가 SVG로 인식하지 못한다.
  if (!svg.includes('xmlns=')) {
    svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"')
  }

  return {
    // base64가 아니라 URI 인코딩을 쓴다 — 한글이 섞일 일이 없고, 디버깅할 때 눈으로 읽힌다.
    dataUrl: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

/** 판서 기본색(빨강)과 같은 값. 수식만 다른 색이면 같은 판서로 보이지 않는다. */
const MATH_COLOR = '#e03131'

/** Excalidraw가 이해하는 파일 한 벌로 감싼다. `fileId`는 요소가 가리킬 이름이다. */
export function mathFileEntry(fileId: string, rendered: RenderedMath, now: number): AnnotationFiles {
  return {
    [fileId]: {
      id: fileId,
      mimeType: 'image/svg+xml',
      dataURL: rendered.dataUrl,
      created: now,
    },
  }
}
