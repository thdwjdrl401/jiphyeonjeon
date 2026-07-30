# 서드파티 라이선스 (프론트엔드 재배포분)

배포되는 산출물에 **코드나 폰트 파일이 그대로 실려 나가는** 서드파티의 라이선스 전문을 둔다.
`node_modules`에 사본이 있는 것으로 충분하지 않은 것들이다.

| 파일 | 대상 | 라이선스 | 왜 여기 있어야 하나 |
|---|---|---|---|
| `excalidraw-MIT.txt` | `@excalidraw/excalidraw` | MIT | **npm 타르볼에 LICENSE 파일이 없다** — `README.md`·`dist/`·`package.json`뿐이다. `package.json`의 `"license": "MIT"` 필드만으로는 MIT가 요구하는 "저작권 표시와 라이선스 전문 포함"을 만족하지 못하므로 상류 저장소에서 가져와 둔다. |
| `xiaolai-OFL.txt` | Xiaolai(小赖字体) 폰트 | SIL OFL 1.1 | 판서의 **한글 글리프를 이 폰트가 렌더**하고, `.woff2` 파일이 우리 오리진에서 서빙된다(ADR-0051). OFL 1.1은 배포 시 **라이선스 전문 포함을 의무**로 정하는데 Excalidraw 패키지는 폰트 라이선스를 동봉하지 않는다. |

## 함께 확인한 것

Excalidraw의 전이 의존성 294개를 훑었다: MIT 237 / ISC 43 / Apache-2.0 11 / BSD-3-Clause 7 / 그 외
permissive 소수. **카피레프트 차단 요소는 없다.** 두 건만 짚어 둔다.

- `dompurify` — `(MPL-2.0 OR Apache-2.0)` 이중 라이선스. Apache-2.0을 택한다.
- `khroma` — `package.json`에 라이선스 필드가 비어 있으나 패키지에 담긴 `license` 파일이 MIT다.

둘 다 **지연 로드되는 mermaid 변환 경로에만** 있어 초기 번들에 포함되지 않는다.

Excalidraw가 함께 배포하는 다른 폰트(Excalifont, Virgil, Nunito, Assistant, Cascadia, Comic Shanns,
Liberation, Lilita One)도 각자의 라이선스를 가지지만 상류가 라이선스 파일을 동봉하지 않는다. 지금
판서에서 실제로 렌더에 쓰이는 것은 Excalifont(라틴)와 Xiaolai(한글)이며, 강사가 폰트를 바꿀 수 있게
되면 그때 해당 폰트의 전문을 여기에 추가한다.
