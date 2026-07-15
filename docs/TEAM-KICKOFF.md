# 팀 킥오프 — LiveClass AI

> 📍 하네스 개요: [harness/README.md](harness/README.md) · 확정 아키텍처: [ARCHITECTURE.md](ARCHITECTURE.md) · 로드맵: [CP-ROADMAP.md](CP-ROADMAP.md) · 계약: [CONTRACT.md](CONTRACT.md)
>
> "누가·언제·어떻게" 를 한 장에. 착수 전 이 문서 + ARCHITECTURE·CP-ROADMAP을 팀 전원이 읽는다. **완전 라이브 지향**(업로드 없음, VOD=라이브 녹화).

## 1. 지금 상태 / 시작점
- 설계 기준선 = [ARCHITECTURE.md](ARCHITECTURE.md)·[CP-ROADMAP.md](CP-ROADMAP.md)·[CONTRACT.md](CONTRACT.md)·[decisions/](decisions/)(master). **먼저 다 같이 리뷰** 후 착수.
- 큰 결정은 ADR에 근거. 반대·보완 의견은 리뷰에서(그 자리가 buy-in 자리).

## 2. 역할 배분 (백엔드 2 / 프론트 2 / AI 2 + 공유)
레이어로 나눴으니 **인터페이스는 계약 우선(CONTRACT.md)** 으로 먼저 합의하고 병렬.

| 그룹 | 담당 플레인·영역 | 주요 CP |
|---|---|---|
| **AI 2** | Python: `realtime-agent`(라이브 STT)·`ai-api`(RAG SSE)·`ai-worker`(PPTX·chunk·embed·후보) | 스파이크 · CP2 · CP3 |
| **BE 2** | Spring: 인증·강좌·`live_session`·채팅·**LiveKit 토큰·Egress 제어**·잡발행·WS·계약. **인프라 backbone 리드** | CP0 · CP1 · CP4 · CP5 |
| **FE 2** | React: 라이브 화상·채팅·자막·챗봇·다시보기 플레이어 UI | CP1 · CP2 · CP3 · CP4 |
| **공유(전담 없음)** | **인프라 backbone**(리드=BE) · **라이브/미디어(CP1) = 3그룹 합동** | T0 · CP1 |

> 오너 확정 후 [CONTRACT §5 오너맵](CONTRACT.md)에 이름 채우기. **라이브(CP1)가 토대·최난도** → 강한 인원 일찍, 3그룹 합동.

### 그룹 × CP 매트릭스 (누가 CP마다 뭘 하나)
**개념**: 그룹(BE/FE/AI)=가로 레이어, CP=세로 기능. **한 CP = 여러 그룹 조각을 계약으로 맞물려 완성.** ("CP1은 누가?"가 아니라 → BE는 토큰/채팅 API, FE는 화상 UI를 각자.)

| CP | **BE 2** (Spring) | **FE 2** (React) | **AI 2** (Python) |
|---|---|---|---|
| **T0** 인프라 | compose·DB·큐·**LiveKit/Egress** **(리드)** | React 스캐폴드·프록시 | *(STT 스파이크 병렬)* |
| **CP0** 인증·강좌 | auth·course/section/lesson·수강 API | 로그인·강좌·내학습 UI | — |
| **CP1** 라이브 미디어 ★ | LiveKit 토큰·채팅 WS | LiveKit 클라·화상·채팅 UI | — |
| **CP2** 자막 | 자막 영속·WS 전달 | 자막 렌더·싱크 | **realtime-agent STT** |
| **CP3** 용어·RAG ★ | AI 게이트웨이·정책·SSE 중계 | 챗봇·용어카드 UI | **chunk·embed·RAG·citation** |
| **CP4** 녹화·다시보기 | Egress 제어·재생토큰 | HLS 플레이어·다시보기 UI | *(2-pass 교정 옵션)* |
| **CP5** 퀴즈·따라잡기 | 퀴즈 채점·API | 퀴즈 UI | *(퀴즈 후보)* |

- **세로**=각 그룹이 여러 CP에 걸쳐 자기 층. **가로**=한 CP는 여러 그룹 조각 → 착수 전 **CONTRACT.md에서 인터페이스 합의** 후 병렬.
- 비유: CP=건물 층, 그룹=직군(전기·배관·목수). 층마다 세 직군이 조금씩.

## 3. 단계 타임라인
| 단계 | 내용 | 누가 |
|---|---|---|
| **0. 합의·배분** | 설계 리뷰, 열린 항목 확정, 역할 확정 | 전원 |
| **1. 바닥 + 리스크 (병렬)** | **T0 backbone**(모노레포·compose·DB·Redis·CI **+ LiveKit/Egress/TURN**) / **STT 스파이크·LiveKit PoC** | BE(인프라) / AI |
| **2. CP0 수렴** | 인증 + 강좌(course→section→lesson) + `live_session` | 전원 기반 |
| **3. 핵심 트랙** | **CP1 라이브 미디어(미니멀 라이브=첫 데모)** → CP2 자막 → CP3 용어·RAG · CP4 녹화·다시보기 · CP5 퀴즈 | 그룹별 |

## 4. 인프라 부트스트랩 원칙
- **공유 backbone 먼저**: 모노레포·docker-compose·Postgres+pgvector·Redis·CI. 라이브가 토대라 **LiveKit·Egress·TURN도 초반(CP1)** 에 필요 → backbone에 포함 or CP1 착수와 함께.
- **무거운 것은 CP 오너가 착수 시점에**: RabbitMQ·MinIO·nginx(CP3/CP4), FastAPI·worker(CP2/3). **영상 업로드/FFmpeg 없음**(VOD=Egress 녹화). → 사일로·과설계 방지.

## 5. 협업 규칙 (하네스가 강제)
- **계약 우선**: FE↔BE, Spring↔AI 인터페이스는 [CONTRACT.md](CONTRACT.md)에서 먼저 합의 → 병렬 개발.
- **브랜치 + MR + CODEOWNERS + [하네스 체크리스트](../.gitlab/merge_request_templates/merge_request_template.md)**. master는 보호 브랜치(직접 커밋 불가).
- **결정은 ADR**([decisions/](decisions/)), 문서는 단일 원본(SSOT). 커밋은 한글 `<타입>: <제목>`.
- 도구는 각자(Claude/Cursor/Codex/Gemini) — 규칙 정본은 [AGENTS.md](../AGENTS.md), 도구별 어댑터 연결됨.

## 6. 착수 전 확정할 열린 항목
- **인증 방식**: JWT(Bearer) vs 세션 쿠키(HttpOnly, 보안 권장) → 확정 후 ADR.
- **STT 공급자**: 한국어 강의 샘플 bake-off(전문용어 recall·지연·비용).
- **세션시계 변환 기준**: LiveKit 트랙 타임스탬프 → 세션 상대 ms.

---
**한 줄**: 0단계(리뷰·역할 확정) → T0+STT/LiveKit 병렬 → CP0 → **CP1 미니멀 라이브(첫 데모)** → 자막·RAG·다시보기. 인터페이스는 계약 우선.
