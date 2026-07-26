# ADR-0036: 강의 자료 임베딩 파이프라인 — outbox→RabbitMQ→AI→pgvector→콜백(inbox)

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 제안 (BE 작성 · AI/FE 조율 필요)
- **일자**: 2026-07-26
- **관련**: [0035](0035-lesson-material-attach.md)(자료→레슨 연결), [0011](0011-ai-three-services.md)(AI 3서비스), [0012](0012-hybrid-queue.md)(하이브리드 큐), [0017](0017-schema-ownership-core-ai.md)(스키마 소유권) · CONTRACT §3-1(잡)·§3-2(콜백) · Jira 예정
- **오너 경계**: BE(송정기) · AI/Python(유채은, `/ai/`) · FE(윤광혁/서민경) · Infra(배포)

## 맥락

강사가 PPTX 자료를 레슨에 연결([0035])하면 **DB 연결 레코드만 저장**되고 끝이다. RAG가 자료를 근거로 쓰려면 파싱→chunk→임베딩→`ai.chunk_embedding`(pgvector) 적재가 있어야 하는데, 그 파이프라인이 없다. 화면도 자료를 항상 `READY`로 표시해 "임베딩 진행 중"을 나타낼 방법이 없다.

**골격은 이미 있다**: `core.outbox_events`(트랜잭션 아웃박스, 주석에 "material_asset·CP2부터 활성"), `core.external_event_inbox`(멱등 수신), `OutboxEvent` 엔티티, CONTRACT §3-1(잡 envelope)·§3-2(콜백). 이 ADR은 그 골격에 **자료 임베딩용 실제 계약·배선**을 정의한다.

## 결정

### 1. per-material 임베딩 상태

`material_asset`에 `embedding_status` 컬럼 추가 — 연결 상태(ACTIVE/DELETED)와 **직교**한다.

| embeddingStatus | 의미 |
|---|---|
| `PENDING` | 잡 발행됨(아직 처리 전) |
| `PROCESSING` | AI가 파싱·임베딩 중(콜백으로 진입 알림, 선택) |
| `READY` | pgvector 적재 완료 → RAG 사용 가능 |
| `FAILED` | 파싱/임베딩 실패(재시도 대상) |

연결 직후 기본값 `PENDING`. 레슨 단위 AI 준비(`lesson.status` AI_NOT_READY→READY)는 "그 레슨 활성 자료가 모두 READY"에서 파생(집계, 후속).

### 2. 발행 = transactional outbox (신뢰성)

자료 연결(commit)과 잡 발행(RabbitMQ)은 서로 다른 시스템이라 한 트랜잭션으로 못 묶는다. attach와 **같은 트랜잭션**에서 `outbox_events`에 잡을 기록하고, 별도 **릴레이**가 읽어 발행한다.

- **outbox 기록**(attach 트랜잭션 내): `aggregate_type=material_asset`, `aggregate_id=materialId`, `event_type=MATERIAL_EMBED_REQUESTED`, `idempotency_key=materialId:embed`(UNIQUE로 중복 발행 차단), `payload_json`=아래 envelope.
- **릴레이**: `(status=PENDING, next_attempt_at<=now)`를 폴링→발행→PUBLISHED. 실패는 `attempt_count++`·백오프, 초과 시 FAILED(+DLQ). `locked_at/by`로 다중 인스턴스 경합 방지.

### 3. 잡 envelope (Spring→AI, RabbitMQ) — CONTRACT §3-1 특화

```json
{
  "jobId": "uuid",
  "idempotencyKey": "material:{materialId}:embed",
  "taskType": "PPTX_EMBED",
  "lessonId": "uuid",
  "curriculumId": "uuid",
  "materialId": "uuid",
  "inputRefs": { "bucket": "liveclass-assets", "objectKey": "materials/...", "fileName": "deck.pptx" },
  "policy": { "chunkSize": 800, "overlap": 100, "embedModel": "..." },
  "contractVersion": 1,
  "correlationId": "..."
}
```
- 큐: `ingestion.embed`(taskType 라우팅). taskType은 §3-1의 `PPTX_PARSE|EMBED`를 자료용 단일 파이프라인 `PPTX_EMBED`로 합친다(파싱+임베딩을 워커가 이어서).
- `inputRefs`로 **바이트 위치만** 넘긴다 — 워커가 스토리지에서 직접 읽는다(앱 서버 미통과).

### 4. 콜백 (AI→Spring, 서명 HTTP, inbox 멱등) — CONTRACT §3-2 특화

```
POST /api/internal/ai/callbacks       (permitAll + HMAC 서명 헤더가 실질 인증, egress webhook과 동일 패턴 0034)
{
  "eventId": "worker측 고유 id",        // (source, eventId) 복합키로 멱등
  "eventType": "MATERIAL_EMBEDDED" | "MATERIAL_EMBED_FAILED",
  "jobId": "uuid",
  "materialId": "uuid",
  "lessonId": "uuid",
  "status": "READY" | "FAILED",
  "outputs": { "chunkCount": 42, "error": null }
}
```
- 수신 시 `external_event_inbox`에 `(source=ai-worker, source_event_id=eventId)` 삽입(중복이면 무시=멱등) → material.embeddingStatus를 READY/FAILED로.
- 서명: 아직 미구현이라([0034]가 egress용으로 만든 HMAC 검증 패턴 재사용) apiSecret 계열 공유 시크릿으로 body 서명.

### 5. 삭제 시

자료 소프트 삭제([0035] detach, 구현됨)와 같은 트랜잭션에 `event_type=MATERIAL_EMBED_DELETE` outbox 기록 → 워커가 `ai.chunk_embedding`에서 그 materialId의 chunk 제거 → RAG가 삭제된 자료를 참조하지 않게. 콜백은 선택(확인용).

### 6. FE 상태 전달 — 초기엔 폴링

materials 응답에 `embeddingStatus` 포함. FE는 `PENDING/PROCESSING`이면 로딩 배지, 자료 목록을 **2~3초 폴링**해 `READY`로 갱신. 즉시성이 필요해지면 STOMP 푸시로 고도화(후속). (임베딩은 수초~수십초라 폴링으로 충분.)

## 근거

- **outbox > 직접 발행**: attach 커밋 후 발행 실패해도 릴레이가 재시도 → 유실 없음. 골격 DDL이 이미 이 구조(`idempotency_key` UNIQUE = 존재 이유).
- **inbox 멱등**: RabbitMQ at-least-once라 콜백이 중복될 수 있다. `(source, eventId)` 복합 PK로 한 번만 처리.
- **바이트는 스토리지 직결**: 잡은 위치(objectKey)만, 워커가 직접 읽는다 — 앱 서버·큐에 바이트를 싣지 않는다([0023] 원칙 4).
- **계약을 먼저 못박는다**: 잡 envelope·콜백 형태를 이 ADR로 확정해야 BE(발행/수신)·AI(소비/발신)가 독립 개발 후 맞물린다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| **outbox + RabbitMQ + inbox 콜백 (선택)** | 신뢰성·멱등·느슨한 결합, 골격 재사용 | 컴포넌트 수↑, RabbitMQ prod 필요 |
| attach 시 AI에 직접 동기 HTTP 호출 | 단순 | 임베딩(수십초)을 요청 안에서 대기 불가, 실패 유실 |
| Redis Streams로 잡 전달 | 이미 STT에 씀 | 배치 잡엔 RabbitMQ가 정석(§3-1), durable·DLQ |

## 영향·후속 (단계별)

- **BE 슬라이스 (RabbitMQ 없이 가능, 우선)**: `embedding_status` 컬럼(Flyway) + attach/detach 시 outbox 기록 + 콜백 inbox 엔드포인트(+멱등) + materials 응답에 status. 콜백을 계약 테스트로 검증(egress webhook 테스트 방식 재사용).
- **outbox→RabbitMQ 릴레이 + prod RabbitMQ**: `spring-amqp` 첫 배선(현재 backend에 의존성 없음). RabbitMQ는 dev-infra에만 있어 **prod 투입 결정 필요**.
- **AI worker (유채은)**: `ingestion.embed` 소비 → PPTX 파싱·chunk·embed → `ai.chunk_embedding` 적재 → 콜백 발신. `ai` 스키마는 Python 단독 쓰기([0017]).
- **FE (윤광혁)**: 로딩 배지 + 상태 폴링·갱신. (`LessonFormPage`에 이미 EMBEDDING/READY 배지 자리 있음.)
- **CONTRACT.md 갱신**: §3-1에 `PPTX_EMBED`·materialId, §3-2에 `MATERIAL_EMBEDDED`, §2 자료 행에 embeddingStatus.

## 조율 필요 (AI/유채은)

이 ADR의 **§3 잡 envelope**·**§4 콜백 계약**·**§5 삭제**를 유채은과 합의해야 확정. 특히: taskType 이름(`PPTX_EMBED`), 큐 이름(`ingestion.embed`), 콜백 경로/서명, `outputs` 필드, `ai.chunk_embedding` 스키마(materialId 참조로 삭제 가능하게).
