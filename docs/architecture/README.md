# 아키텍처 다이어그램

> 📍 정본 문서: [../ARCHITECTURE.md](../ARCHITECTURE.md) · 로드맵: [../CP-ROADMAP.md](../CP-ROADMAP.md)
>
> 발표·온보딩·설계 논의에 쓰는 그림 자산. **글로 된 정본은 `ARCHITECTURE.md`이고, 여기 있는 건 그것의 시각화다.**
> 설계가 바뀌면 정본을 먼저 고치고 그림을 따라 맞춘다.

## 무엇이 들어 있나

| 경로 | 내용 | 성격 |
|---|---|---|
| `liveclass-architecture.drawio` | **기능 슬라이스 15탭** | 편집 가능한 원본 |
| `diagrams/light/*.svg` · `diagrams/dark/*.svg` | 전체 구조 7종 | 정적 렌더 |
| `tools/` | 위 `.drawio`의 최초 생성 스크립트 | 재현용 |

## 1. `liveclass-architecture.drawio` — 편집 원본

서비스를 **기능 단위로 자른** 15개 탭이다. 각 탭 하단에 그 슬라이스의 설계 근거와 미해결 지점을 적어 뒀다.

| 탭 | 슬라이스 |
|---|---|
| 00 | 기능 슬라이스 지도 — 무엇이 되고 무엇이 비었는지 한 장 |
| 01 | 인증과 세션 |
| 02 | 커리큘럼 탐색 (공개 카탈로그) |
| 03 | 커리큘럼 관리 (강사) |
| 04 | 섹션·레슨 구조 편집 — 재정렬과 `structure_version` CAS |
| 05 | 수강 신청과 승인 |
| 06 | 라이브 세션 수명주기 |
| 07 | 실시간 채팅 |
| 08 | 자료 업로드 (presigned) |
| 09 | 녹화와 다시보기 |
| 10 | 라이브 자막 (CP2) |
| 11 | 용어·근거 RAG (CP3) |
| 12 | 배포 토폴로지 |
| 13 | 백엔드 모듈 의존 |
| 14 | 스키마 소유권 |

**여는 법** — 셋 중 아무거나.
- [app.diagrams.net](https://app.diagrams.net) 에서 열기 (설치·로그인 불필요)
- VS Code + `Draw.io Integration` 확장 설치 후 파일 더블클릭
- draw.io 데스크톱 앱

**내보내기** — `File → Export as → SVG / PNG / PDF`. 슬라이드에는 SVG가 가장 깔끔하다.

## 2. `diagrams/` — 정적 렌더

전체 구조를 스케일·관점별로 본 7종. 편집 없이 바로 쓸 수 있게 SVG로 떠 뒀다.

| 파일 | 보는 각도 |
|---|---|
| `01-system-context` | 바깥에서 본 경계 — 발표 첫 장 |
| `02-containers` | 돌아가는 프로세스 전부 · 구현/미구현 |
| `03-backend-modules` | 모듈 의존 그래프 |
| `04-deployment` | 서버 한 대에 얹은 두 스택 |
| `05-live-caption-pipeline` | 말 → 자막, 그리고 지평선 |
| `06-schema-ownership` | `core` / `ai` 쓰기 권한 |
| `07-trust-boundaries` | 브라우저가 자원에 닿기까지 |

`light/`는 밝은 배경, `dark/`는 어두운 배경용이다. 벡터라 확대해도 깨지지 않는다.

## 3. `tools/` — 생성 스크립트

`.drawio`를 **처음 만들 때** 쓴 스크립트다. 노드·연결선을 파이썬 데이터로 정의하고 mxGraphModel XML로 내보낸다.

```bash
cd docs/architecture/tools && python3 build_slices.py   # → liveclass-architecture.generated.drawio
```

> ⚠️ 출력 파일 이름이 다르다(`.generated.drawio`). **원본을 덮어쓰지 않는다** —
> draw.io에서 손으로 고친 내용이 스크립트 재실행으로 날아가지 않게 하기 위해서다.
> 최초 생성 이후로는 `liveclass-architecture.drawio`가 원본이고, 스크립트는 참고용이다.
> 슬라이스를 통째로 다시 뽑고 싶을 때만 쓴다.

## 표기 규칙

그림 전체가 같은 언어를 쓴다.

| 표기 | 뜻 |
|---|---|
| 초록 실선 | 구현·동작 확인됨 |
| 회색 점선 | 미착수 — 설계 의도 (CP2~CP3) |
| 파란 굵은 테두리 | 그 그림의 주인공 |
| 주황 원통 | 상태 저장소 |
| 빨간 화살표 | 백엔드를 우회하는 데이터 경로 |

빨간 화살표가 핵심이다 — 미디어와 파일 바이트는 Spring을 통과하지 않지만, 그 앞에는 반드시 Spring이 발급한 증명(LiveKit JWT · presigned URL)이 있다.
