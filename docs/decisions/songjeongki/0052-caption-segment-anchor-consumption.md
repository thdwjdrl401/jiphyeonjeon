# ADR-0052: 자막 발화 경계·시간 앵커 소비 — Spring 영속(1차 슬라이스)

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택 (BE 구현)
- **일자**: 2026-07-31
- **관련**: [0043](0043-caption-consumer-persistence.md)(자막 소비·영속·WS), [0040](0040-caption-delta-contract.md)(델타 계약), [0045](0045-live-caption-position-sync-approx-session-ms.md)(근사 세션-ms), [0047](0047-live-ai-answer-sse-proxy.md)(RAG contextTimeMs), CONTRACT §3-4·§3-6·§3-9, MR `!233`(AI producer)
- **오너 경계**: BE(송정기) — 소비·영속 / AI(유채은) — agent 발행(`!233` 병합 완료) / FE(윤광혁·서민경) — 세그먼트 렌더(후속)

## 맥락

realtime-agent가 `caption.stream.started`(첫 오디오 프레임의 절대 UTC 시간 앵커)와
`caption.segment.final`(client VAD가 확정한 한 발화의 경계·시각·텍스트)를 추가로 발행하도록
`!233`이 병합됐다(schema·fixture 반영). 두 이벤트는 기존 `caption.delta`/`caption.stream.completed`를
**유지한 채 추가**되는 순수 additive 변경이다.

이전에 FE는 앵커가 없어 문장부호 휴리스틱(ADR-0044)으로 발화 경계를 **근사**했고, 세션-ms는
`occurredAt−clockOriginAt` 근사(ADR-0045)에 의존했다. 두 신규 이벤트는 그 근사를 정확한 값으로
대체할 근거를 준다 — 그러나 그 활용(FE 렌더·seek, RAG 앵커)은 FE 계약·RAG 의미 변경을 수반하므로
한 번에 하지 않는다.

**소비 측 위험(구현 전 확인):** 기존 Spring 파서는 모르는 `type`을 poison으로 ACK 폐기하므로 producer만
먼저 배포돼도 깨지지 않는다. 그러나 두 신규 type을 **같은 스트림에 흘리기 시작하면** 두 곳이 회귀한다.
① `WsCaptionBroadcaster`는 `completed`가 아닌 것을 전부 delta로 취급해 FE에 깨진 delta를 보낸다.
② RAG `contextTimeMs`는 "최신 자막 행의 raw `streamElapsedMs`"인데, 신규 type 행(단일 `streamElapsedMs`
없음)이 최신이 되면 `null`을 뽑아 `LiveAiAnswerService`가 NPE를 낸다. 리로드(§3-6)도 신규 type 행을
delta로 노출한다.

## 결정

**1차 슬라이스: 두 신규 type을 영속만 하고, 표시(WS·리로드·RAG)는 기존 2종으로 유지한다.**

### 1. 영속 — 같은 append-only ingest 로그 확장

- 별도 테이블을 만들지 않고 `core.live_caption`을 확장한다(V12 — 최초 V11이었으나 판서 마이그레이션과 버전 충돌로 rename, hotfix `!242`). 두 신규 type도 같은 스트림의 엔트리이고
  같은 멱등키(`eventId`)·같은 소비 경로를 쓰므로 delta/completed와 공존시키는 게 ADR-0043 모델과 일치한다.
- 신규 컬럼(그 외 type엔 NULL): `audio_started_at`(started 앵커), `segment_index`·`start_stream_elapsed_ms`·
  `end_stream_elapsed_ms`·`boundary_reason`(segment.final). `event_type` CHECK를 4종으로 확장한다.
- `stream_elapsed_ms`를 **NULLABLE로 완화**한다 — started엔 그 필드가 없고 segment.final은 start/end 쌍만
  가진다. delta/completed는 파서가 여전히 값을 강제한다.
- 파서(`CaptionEventParser`)는 wire schema를 그대로 강제한다: `audioStartedAt`은 UTC(`Z`\|`+00:00`),
  `boundaryReason`은 `SILENCE`\|`MAX_DURATION`\|`STREAM_END`, 정수 필드는 부호 없는 18자리. 위반은
  기존과 같이 poison ACK 폐기.

### 2. 표시 경로 보존 — `RELAYED_TYPES` 게이트

- WS 전달·자막 리로드·RAG `contextTimeMs`는 **표시 대상 type = `{caption.delta, caption.stream.completed}`**
  (`CaptionEvent.RELAYED_TYPES`)만 대상으로 한다.
- `persist`는 신규 type이면 `LiveCaptionStoredEvent`를 **발행하지 않는다**(WS 무전달). 리로드·RAG 최신행
  조회는 `...AndEventTypeIn(RELAYED_TYPES)` 쿼리로 신규 type을 배제한다. 이로써 producer가 신규 이벤트를
  쏘기 시작해도 기존 FE/RAG 동작은 **바이트 단위로 동일**하다.

## 대안

| 대안 | 판단 |
|---|---|
| 신규 type을 **폐기**(계속 poison)로 두기 | 세그먼트마다 warn 로그가 쌓이고 raw 데이터가 유실돼 후속 슬라이스가 재수집 불가 → 기각 |
| 신규 type 전용 **별도 테이블** | 같은 스트림·같은 멱등·같은 소비 경로를 둘로 쪼개 소비 코드가 이원화 → 기각(후속에 read model이 필요하면 그때 도입) |
| **한 번에** WS/REST/RAG·FE 렌더까지 | FE 계약(ADR-0044 제거)·RAG 앵커 의미 변경까지 묶여 대형·다오너 변경이 됨. additive라 안전하게 쪼갤 수 있어 기각 |

## 영향·후속

- **무회귀**: 표시 경로가 기존 2종으로 고정돼 producer 선배포에도 FE/RAG 불변. 신규 type은 조용히 적재만.
- **후속 슬라이스**(별도 MR): ① FE — ADR-0044 휴리스틱 제거, `segment.final`당 렌더, 세그먼트 ms로 seek.
  ② Spring — `audioStartedAt` 앵커 기반 정확한 세션-ms(ADR-0045 근사 대체)·segment 기반 WS/REST payload·
  RAG `contextTimeMs`의 앵커화(ADR-0047 §시간축). 각 슬라이스에서 `RELAYED_TYPES`를 넓히거나 별도 전달
  채널을 연다.

## 계약 테스트

- `LiveCaptionStreamContractTest`(POLICY: Python↔Spring 공유 스트림 필드 계약 + 자막 핵심경로)에 정본 fixture
  `caption-stream-started.valid.json`·`caption-segment-final.valid.json`을 그대로 XADD해 ① 신규 컬럼 영속,
  ② 표시 필터(`RELAYED_TYPES`)가 신규 type을 리로드·RAG 최신행에서 배제, ③ 최신 표시행의 `streamElapsedMs`
  비-null(RAG NPE 회귀 방지)을 고정한다. delta/completed·멱등·poison 폐기 기존 케이스는 그대로 유지.
