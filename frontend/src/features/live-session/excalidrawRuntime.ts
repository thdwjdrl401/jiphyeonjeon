/**
 * Excalidraw를 지연 로드하는 단일 경계(ADR-0051).
 *
 * <p><b>왜 한 곳으로 모으는가.</b> 두 가지를 여기서만 보장하기 위해서다.
 *
 * <ol>
 *   <li><b>번들 분리.</b> Excalidraw는 초기 로드에 +309~365KB(gzip)를 더한다 — 현재 우리 엔트리
 *       65KB의 5.6배다. 트리셰이킹은 기대할 수 없다(패키지에 `sideEffects` 선언이 없고 렌더 전용
 *       진입점도 없어, `exportToCanvas`만 import해도 56KB밖에 줄지 않는다). 그래서 정적 import를
 *       금지하고 <b>동적 import만</b> 둔다. 강사 화면과 Egress 페이지만 이 비용을 지불하고,
 *       수강생은 합성 결과만 보므로(ADR-0032) 한 바이트도 받지 않는다.</li>
 *   <li><b>폰트 출처.</b> `EXCALIDRAW_ASSET_PATH`를 설정하지 않으면 폰트를 외부 CDN
 *       (`https://esm.sh/...`)에서 가져온다. Egress의 헤드리스 Chrome이 외부 의존을 갖게 되고,
 *       실패하면 판서 텍스트가 fallback 글꼴로 조용히 녹화된다. import보다 <b>먼저</b> 설정해
 *       그 경로가 쓰일 여지를 없앤다.</li>
 * </ol>
 *
 * <p>폰트 로딩 자체는 우리가 신경 쓸 필요가 없다 — `exportToCanvas`는 첫 줄에서 해당 요소들에
 * 필요한 폰트를 `await`한다. 한글 폰트가 0개 로드된 상태에서 export해도 결과가 예열 후와 픽셀까지
 * 동일함을 확인했다(ADR-0051).
 */

declare global {
  interface Window {
    /** Excalidraw가 폰트 URL의 기준으로 읽는다. 문자열 또는 후보 배열. */
    EXCALIDRAW_ASSET_PATH?: string | string[]
  }
}

/**
 * 복사된 폰트가 사는 경로. `scripts/copy-excalidraw-assets.mjs`가 `public/excalidraw/`를 채우고,
 * Excalidraw는 이 기준에 `fonts/<Family>/<file>.woff2`를 붙여 요청한다.
 */
export const EXCALIDRAW_ASSET_PATH = '/excalidraw/'

type ExcalidrawModule = typeof import('@excalidraw/excalidraw')

let pending: Promise<ExcalidrawModule> | null = null

/**
 * Excalidraw 모듈을 가져온다. 여러 번 불러도 청크는 한 번만 내려온다.
 *
 * <p>에셋 경로를 import <b>전에</b> 세운다. 모듈 최상단에 두면 ESM이 import를 먼저 실행하므로,
 * 순서를 확실히 하려면 함수 안이어야 한다.
 */
export function loadExcalidraw(): Promise<ExcalidrawModule> {
  if (!pending) {
    window.EXCALIDRAW_ASSET_PATH = EXCALIDRAW_ASSET_PATH
    pending = import('@excalidraw/excalidraw')
  }
  return pending
}
