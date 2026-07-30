/**
 * Excalidraw 폰트를 `public/excalidraw/`로 복사한다.
 *
 * <p><b>왜 복사가 필요한가.</b> Excalidraw는 폰트를 번들에 넣지 않고 런타임에 URL로 가져온다.
 * 그 기준 경로(`window.EXCALIDRAW_ASSET_PATH`)를 설정하지 않으면 기본값이
 * `https://esm.sh/@excalidraw/excalidraw@<version>/dist/prod/`다 — 즉 <b>Egress의 헤드리스 Chrome이
 * 외부 CDN에 의존</b>하게 되고, 그 CDN이 막히거나 느리면 판서 텍스트가 fallback 글꼴로 녹화된다.
 *
 * <p><b>왜 git에 넣지 않는가.</b> 폰트가 13MB다(대부분 Xiaolai의 CJK 서브셋 209개). 저장소에 넣을
 * 이유가 없다 — node_modules에 이미 있으니 빌드 때 꺼내 쓰면 된다. 그래서 `public/excalidraw/`는
 * `.gitignore`에 있고 이 스크립트가 `predev`/`prebuild`에서 채운다.
 *
 * <p>서브셋은 필요한 유니코드 범위만 지연 로드된다. 한글은 Xiaolai 209개 중 50개가 덮는다(ADR-0051).
 */
import { cp, mkdir, readdir, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const frontend = resolve(here, '..')
const source = join(frontend, 'node_modules/@excalidraw/excalidraw/dist/prod/fonts')
const target = join(frontend, 'public/excalidraw/fonts')

if (!existsSync(source)) {
  // 조용히 넘기지 않는다. 폰트가 빠진 채 빌드가 성공하면 그 사실이 녹화에서야 드러난다.
  console.error(`[excalidraw] 폰트 원본을 찾을 수 없다: ${source}`)
  console.error('[excalidraw] `npm install`이 끝났는지 확인하라.')
  process.exit(1)
}

await rm(target, { recursive: true, force: true })
await mkdir(dirname(target), { recursive: true })
await cp(source, target, { recursive: true })

const families = await readdir(target)
console.log(`[excalidraw] 폰트 ${families.length}종 복사 완료 → public/excalidraw/fonts`)
