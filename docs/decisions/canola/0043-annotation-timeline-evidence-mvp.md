# ADR-0043: 강조 판서 스냅샷을 시간 앵커 근거로 색인·검색한다 (MVP)

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책:
> [../../harness/POLICY.md](../../harness/POLICY.md) · 공유 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 승인 — AI 슬라이스(W1~W5·A1~A4) 구현 완료, E1(E2E)은 Spring outbox 대기
- **일자**: 2026-08-04
- **적용 범위**: `ai-worker`(색인), `ai-api`(검색·근거), `ai.annotation_snapshot`(신규 스키마)
- **관련**:
  [songjeongki/ADR-0074](../songjeongki/0074-annotation-highlight-evidence-contract.md)(강조 판서 근거 계약 요청 — 이 문서가 그 응답),
  [ADR-0042](0042-replay-ai-caption-context-contract.md)(다시보기 자막 근거 계약),
  [ADR-0037](0037-ai-roadmap-and-evaluation-gates.md)(AI 로드맵 — 판서 트랙·VOD RAG 시점 규칙),
  [jinwoo/ADR-0007](../jinwoo/0007-curriculum-scoped-rag-material-sharing.md)(커리큘럼 검색 스코프),
  [jinwoo/ADR-0008](../jinwoo/0008-replay-rag-answer-v2-endpoint.md)(다시보기 v2 endpoint),
  [songjeongki/ADR-0054](../songjeongki/0054-annotation-ai-semantics-not-coordinates.md)·[0058](../songjeongki/0058-annotation-interpret-image-by-url.md)(판서 해석 선례)

## 맥락

ADR-0074는 강사가 강조 툴로 표시한 순간의 합성 이미지를 AI가 색인하고 영실이 근거로 쓰는
계약을 요청했다. 여기에 우리가 최종적으로 원하는 사용자 시나리오를 더한다:

> **"강사님이 아까 강조하신 게 뭐였지?"**

이 질문은 의미(무엇) 검색만으로는 풀리지 않는다. 두 가지가 필요하다.

1. **행위의 영속**: 강조라는 강사 행위가 *언제*(`sessionMs`) *무슨 내용*(텍스트)이었는지가
   함께 남아야 한다. 현재 판서 해석 결과는 화면에 적용되고 폐기된다(ADR-0074 "현재 부족한 점").
2. **시간을 다루는 검색**: "아까"는 임베딩 공간에 없는 시간 지시어다. 벡터 유사도는
   "강조하신 게 뭐였지"라는 질문과 강조된 *내용*(예: "B+ tree 분할 조건") 사이의 유사도를
   보장하지 못한다.

시간이 짧으므로 MVP로 자른다. 이 문서는 저장 스키마, 잡 수용, 검색 결합, "아까" 해석 방식을
결정하고 ADR-0074의 열린 질문 4개에 답한다.

## 결정

### 1. 저장 — 자료 색인과 분리된 `ai.annotation_snapshot` 단일 테이블

ADR-0074 열린 질문 3의 답: **별도 색인에 넣고 검색에서 합친다.**

`ai.material_version`은 `page`·`material_version`이 필수라 판서를 넣으면 근거 표시가
거짓말한다(0074가 지적한 문제 그대로). ai-worker 소유 alembic migration으로 신규 테이블을 만든다.

```sql
CREATE TABLE ai.annotation_snapshot (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  snapshot_id    uuid NOT NULL UNIQUE,          -- 멱등 키 (0074: 한 강조당 한 스냅샷)
  asset_id       uuid NOT NULL,
  curriculum_id  uuid NOT NULL,                 -- 검색 스코프 축 (자료와 동일, ADR-0007)
  lesson_id      uuid NOT NULL,
  session_id     uuid NOT NULL,
  session_ms     bigint NOT NULL CHECK (session_ms >= 0),  -- 다시보기 타임라인 앵커
  captured_at    timestamptz NOT NULL,
  text           varchar(2000) NOT NULL,        -- 색인된 해석 텍스트
  text_origin    varchar(16) NOT NULL CHECK (text_origin IN ('SPRING', 'MODEL')),
  search_vector  tsvector GENERATED ALWAYS AS (to_tsvector('simple', text)) STORED,
  embedding      vector(1024) NOT NULL,         -- bge-m3, 자료와 동일
  state          varchar(16) NOT NULL CHECK (state IN ('ACTIVE', 'DELETED')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ix_annotation_snapshot_scope    ON ai.annotation_snapshot (curriculum_id, state);
CREATE INDEX ix_annotation_snapshot_timeline ON ai.annotation_snapshot (session_id, state, session_ms DESC);
CREATE INDEX ix_annotation_snapshot_fts      ON ai.annotation_snapshot USING gin (search_vector);
CREATE INDEX ix_annotation_snapshot_hnsw     ON ai.annotation_snapshot USING hnsw (embedding vector_cosine_ops);
```

- **청킹하지 않는다.** 스냅샷 1건 = 텍스트 1개 = 임베딩 1개. 강조 한 번의 해석 텍스트는
  짧아서(≤2,000자) chunk 파이프라인이 필요 없고, 근거 excerpt와 색인 단위가 1:1이라
  "무엇이 검색됐는지"가 항상 명확하다.
- 삭제는 행 제거가 아니라 `state='DELETED'` 전환으로 한다. 재발행 멱등 판정과 운영 감사가
  단순해진다(자료 색인의 shadow version 철학과 동일, ADR-0015).

### 2. 인제스천 — 같은 큐·같은 봉투·같은 콜백·같은 download-url

ADR-0074 열린 질문 1의 답: **판서용 경로를 새로 파지 않는다.**

- `ingestion.embed` 큐에 `taskType` discriminator로 두 잡을 추가한다:
  `ANNOTATION_EMBED`(0074 요청 1의 payload 그대로), `ANNOTATION_EMBED_DELETE`(`snapshotId`만).
- 이미지는 `assetId`로 기존 `POST /api/internal/ai/materials/download-url`에서 갓 서명된
  presigned GET을 받아 읽는다. PPTX와 동일 어댑터를 재사용한다.
- 멱등: `snapshot_id` 기준 upsert. 같은 `snapshotId` 재발행은 기존 행을 교체하고 성공 처리.
  삭제는 지울 게 없어도 성공(`EMBED_DELETE`와 동일 철학, jinwoo/ADR-0006).
- 콜백: 기존 `POST /api/internal/ai/callbacks`(HMAC·`eventId` 멱등)로
  `eventType=ANNOTATION_EMBEDDED|ANNOTATION_EMBED_FAILED` + `snapshotId`를 돌려준다.
- 전체 기능은 `AI_WORKER_ANNOTATION_INGESTION_ENABLED`(기본 `false`) 스위치 뒤에 둔다.
  Spring 쪽 outbox 스위치와 독립이다. 꺼진 상태에서 annotation 잡이 오면 영구 실패와 같은
  경로로 **DLQ에 보존**한다(`ingestion.embed.dlq`) — RabbitMQ에서 ACK도 requeue도 하지 않는
  제3의 보존은 없으며, requeue는 재전달 루프를 만든다. 스위치를 켠 뒤 DLQ 재발행으로
  재처리하므로 배포 순서가 어긋나도 잡이 유실되지 않는다.

### 3. 텍스트 결정 — `interpretedText` 우선, 없으면 GMS 멀티모달 1회 텍스트화

ADR-0074 열린 질문 2의 답: **있으면 그대로 신뢰하고 재해석하지 않는다.**

| `interpretedText` | 색인 텍스트 | `text_origin` |
|---|---|---|
| 비어 있지 않음 | 그 값 그대로 (트리밍만) | `SPRING` |
| 비어 있음 | GMS 멀티모달 1회 호출로 이미지 텍스트화 | `MODEL` |

- 있는 해석을 다시 읽어 다른 텍스트를 만들면 강사 화면과 근거가 갈라진다(0074의 우려).
  MVP에서는 **이미지 보강(있는 텍스트에 이미지 맥락 추가)도 하지 않는다** — 갈라짐 위험 대비
  이득이 불확실하고, 보강 품질 평가셋이 없다. 후속 범위로 명시한다.
- 강조 툴 경로는 해석 경로(ADR-0054·0058)와 별개라 `interpretedText`가 비어서 오는 경우가
  기본값에 가깝다. 따라서 모델 텍스트화가 없으면 기능 자체가 성립하지 않는다.
  ai-worker의 기존 GMS 클라이언트(핵심 용어 추출과 동일 어댑터 계열)를 확장해 presigned URL을
  `image_url`로 전달한다(이미지를 URL로 넘기는 선례: ADR-0058). 프롬프트는 "강조 표시된 부분을
  중심으로, 화면에 실제로 보이는 텍스트·수식·도표 내용을 서술"로 고정하고 plain text만 받는다.
- 모델 키는 `AI_WORKER_GMS_API_KEY` 재사용. 텍스트화 실패(연결·429·빈 응답)는 잡 재시도 규칙을
  그대로 따르고, 소진 시 `ANNOTATION_EMBED_FAILED`로 콜백한다 — 자료 처리와 달리 이 잡은
  텍스트가 산출물 그 자체라 핵심 용어 추출처럼 "실패해도 계속"으로 처리할 수 없다.

### 4. 검색 — 자료 Top-K와 병렬 검색 후 근거 결합

ai-api에 `AnnotationSearchPort`를 추가하고 기존 `CombinedEvidenceRetriever`(v1)와
`ReplayEvidenceRetriever`(v2)가 자료 검색과 **병렬로** 호출한 뒤 근거를 합친다.

- **스코프**: `curriculum_id = :curriculumId AND state = 'ACTIVE'` — 자료와 같은 축(ADR-0007).
- **시점 규칙** (로드맵 ADR-0037 §4-5 "질문 시각 이후 근거 제외"와 일치):
  - **다시보기(v2)**: 같은 `sessionId`의 스냅샷은 `session_ms <= questionSessionMs`만 허용.
    다른 세션(지난 강의)의 스냅샷은 전부 허용 — 이미 끝난 강의라 전체가 과거다.
  - **라이브(v1)**: 시간 필터 없음. 색인이 잡 처리 후에만 존재하므로 색인된 스냅샷은
    정의상 질문 이전이다. v1의 `contextTimeMs`는 STT attempt-local이라 `session_ms`와
    비교할 수 없고, 비교할 필요도 없다.
- **랭킹**: 자료와 동일한 RRF hybrid(vector + lexical)를 재사용한다.
- **개수**: annotation Top-K 기본 2. 자료 Top-K 3은 그대로 둔다.
- **sufficiency**: annotation 근거도 자막처럼 충분성에 산입한다. 자료·자막·판서가 모두
  없을 때만 `answer.insufficient`.

### 5. "아까"의 해석 — 시간 지시어를 파싱하지 않고 모델에 시각을 준다

이 ADR의 핵심 결정이다. 질의어에서 "아까/방금/좀 전"을 파싱하는 시간 이해 모듈은 만들지
않는다. 대신 두 메커니즘을 조합한다.

1. **recent-annotation window**: 같은 `sessionId`의 최근 스냅샷 최대 N개(기본 5)를
   **유사도와 무관하게** 항상 문맥에 포함한다. 라이브는 `session_ms` 내림차순 최근 N개,
   다시보기는 `questionSessionMs` 이전 최근 N개. 자막 rolling window와 같은 취급이며,
   벡터 검색(§4)과는 별개 경로다.
2. **시각을 프롬프트에 명시**: annotation 근거마다 `highlightedAt`을 `mm:ss`(한 시간을 넘으면
   `h:mm:ss`)로 붙인다. 다시보기는 질문 시점도 같은 형식의 `askedAt`으로 함께 주어 모델이
   "아까"를 두 시각의 비교로 해석하게 한다. 라이브에는 `askedAt`을 넣지 않는다 —
   `contextTimeMs`는 STT attempt-local이라 세션 시각과 다른 축이고, 나란히 두면 모델이 서로
   다른 타임라인을 비교하게 된다. 라이브에서는 window의 정렬 자체가 최신순 신호다.
   `snapshotId`는 프롬프트에 넣지 않는다. 출처는 서버가 붙이므로 모델에게는 토큰 낭비다.
   system prompt에 시점 질문 해석 규칙을 명시하고, citation 규칙은 기존과 동일하다.

이 분담으로: "아까 강조하신 게 뭐였지"(시간 질의)는 window가 보장하고, "X에 대해 강조했던 거
뭐였지"(의미 질의)는 벡터 검색이 보장한다. 두 경로에서 같은 스냅샷이 나오면 `snapshotId`로
중복 제거한다.

파서를 만들지 않는 이유: 시간 지시어의 한국어 변형("아까", "방금 전에", "처음에", "10분쯤
전에")을 규칙으로 덮으려면 평가셋과 반복이 필요한데 MVP 기간에 맞지 않고, 최근 N개 window는
파서 없이도 이 질의 계열 대부분을 커버한다. window 크기 N과 문자 예산은
`AI_API_ANNOTATION_WINDOW_*` 환경변수로 조정한다.

### 6. 근거 표현 — `ANNOTATION` source (0074 요청 3의 답)

v1·v2 `answer.done.sources` union에 additive로 추가한다. 기존 member는 변경하지 않는다.

```json
{
  "type": "ANNOTATION",
  "snapshotId": "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "sessionMs": 725300,
  "excerpt": "B+ tree 노드 분할 조건: 키 개수가 2d를 초과할 때"
}
```

- 0074가 요구한 세 가지를 그대로 만족한다: (1) `type`으로 자료와 구분, (2) `sessionMs`로
  영상 seek, (3) 원문 그대로의 `excerpt`(모델 재요약 금지, ≤300자 — v2 자막 excerpt와 동일 규칙).
- v1에서는 기존 v1 source들처럼 `excerpt`를 optional로, v2에서는 필수로 둔다.
- 중복 제거 기준은 `snapshotId`.
- Spring SSE proxy는 이벤트를 변환 없이 릴레이하므로(ADR-0047) Spring 변경은 불필요하고,
  FE 렌더·seek 연결은 FE 오너 범위다.

### 7. 이미지 입력 상한 (0074 열린 질문 4의 답)

- PNG, **최대 4MB** — 워커가 다운로드 시 Content-Length와 실수신 바이트 양쪽으로 강제한다
  (Content-Length가 없거나 거짓이어도 무한 읽기가 되지 않는다).
- 긴 변 **1,568px** 초과분은 거부하지 않고 워커가 종횡비를 유지해 축소한 뒤 모델에 보낸다.
  강사가 이미 확인한 근거를 비용 때문에 버리지 않으면서 vision tile 과금을 제한한다.
  이미 한도 안이면 재인코딩하지 않고 원본 bytes를 그대로 쓴다.
- 디코드·축소는 동기 CPU 작업이라 event loop 밖(`asyncio.to_thread`)에서 실행하고,
  5천만 픽셀을 넘는 입력은 decompression bomb으로 보고 거부한다.

## MVP에서 하지 않는 것

- 수식 IR·LaTeX·Mermaid 변환 — 로드맵 [ADR-0037](0037-ai-roadmap-and-evaluation-gates.md) 판서
  트랙의 별개 범위. 이 ADR은 "텍스트화해서 근거로 검색"까지만이다.
- `interpretedText`가 있는 스냅샷의 이미지 보강 재해석(§3).
- 자동 색인 — 강사 확인 게이트 유지(0074 보장 사항).
- 시간 지시어 파싱, 강조 빈도·밀도 분석, "가장 중요했던 것" 랭킹.
- 세션·강의 일괄 삭제 잡 — Spring이 스냅샷별 `ANNOTATION_EMBED_DELETE`를 발행한다.
- Spring 쪽 outbox·스냅샷 저장·강조 내역 패널(Spring·FE 오너, 0074 "우리 쪽 진행").
- multi-replica 워커의 동일 스냅샷 동시 처리 조정(단일 워커 전제 유지).

## 구현 순서 (MVP 슬라이스)

현재 RAG 형태를 기준으로 한 실행 계획이다. 각 슬라이스는 독립 머지 가능하고, 앞 슬라이스가
머지돼도 스위치·미배선 상태라 런타임 동작이 바뀌지 않는다(무회귀). **W# = ai-worker,
A# = ai-api, E# = 통합.** W1 이후 W-트랙과 A-트랙은 병렬 진행 가능하며, A2는 아무 의존 없이
가장 먼저 시작해도 된다. Spring 쪽(outbox·스냅샷 저장·FE 렌더)은 이 표의 의존이 아니다 —
E1만 Spring outbox 이후 가능하다.

| # | 무엇을 | 어디에 (기존 코드 기준) | 완료 기준 | 의존 |
|---|---|---|---|---|
| **W1** | `ai.annotation_snapshot` migration | `ai-worker/migrations/versions/0003_annotation_snapshot.py` — §1 DDL 그대로. `0001_rag_index_storage.py`의 role 검증·GRANT 패턴(runtime role에 SELECT/INSERT/UPDATE만) 복제 | `alembic upgrade head` 성공, runtime role로 CRUD smoke. 번호는 `scripts/check-version-collisions.sh`로 확인 | 없음 |
| **W2** | 잡·콜백 wire 계약 | `ai-worker/app/contracts/material_jobs.py` — `AnnotationEmbedJob`/`AnnotationEmbedDeleteJob`을 `MaterialJob` discriminator union에 추가(§2 payload, `_WireModel` camelCase 규칙 준수). `contracts/spring_callbacks.py` — `ANNOTATION_EMBEDDED`/`ANNOTATION_EMBED_FAILED` eventType 추가 | 파싱 계약 테스트: 정상/필드 누락/`sessionMs<0`/64KiB 초과 거부. 기존 PPTX 잡 테스트 무회귀 | 없음 |
| **W3** | GMS 멀티모달 텍스트화 어댑터 | `ai-worker/app/adapters/gms_annotation_reader.py`(신규) — `gms_key_term_extractor.py`의 클라이언트·재시도 계열을 따라가되 `image_url`(presigned GET)을 싣는 vision chat completion. §3 프롬프트 고정, plain text ≤2,000자 반환 | 단위 테스트(응답 파싱·빈 응답 실패·트리밍). 실 GMS 호출은 opt-in 테스트로 분리(AGENTS 규칙) | 없음 |
| **W4** | 색인·삭제 유스케이스 | `ai-worker/app/adapters/pgvector_annotation_index.py`(신규) — `snapshot_id` upsert·`state` 전환. `app/application/index_annotation_snapshot.py`·`delete_annotation_snapshot.py`(신규) — `index_pptx_material.py` 구조를 따름: download-url(기존 `spring_material_asset_store` 재사용, PNG 4MB·다운스케일 §7) → 텍스트 결정(§3 표: `interpretedText` 우선, 없으면 W3) → bge 임베딩(기존 `remote_bge_embedding`) → upsert → 콜백(기존 `spring_material_callback` 확장) | 유스케이스 단위 테스트: interpretedText 유/무 분기, 재발행 멱등(같은 `snapshotId` 교체), 삭제 멱등(없어도 성공), 텍스트화 소진 시 FAILED 콜백. pgvector 테스트는 격리 DB(ADR-0017) | W1·W2·W3 |
| **W5** | 컨슈머 라우팅·스위치 | `ai-worker/app/adapters/rabbitmq_material_consumer.py` — `map_material_job.py`에 신규 taskType→유스케이스 매핑, `AI_WORKER_ANNOTATION_INGESTION_ENABLED`(기본 false) 게이트: 꺼짐이면 DLQ 보존(§2). config에 env 추가 | 라우팅 테스트: 켜짐/꺼짐 각각의 ACK·DLQ 경로, 기존 PPTX 경로 무회귀. 여기까지 머지되면 워커는 **완결** — Spring이 잡을 안 보내는 동안 무동작 | W4 |
| **A1** | annotation 검색 어댑터·포트 | `ai-api/app/adapters/pgvector_annotation_retrieval.py`(신규) — `pgvector_material_retrieval.py`의 RRF hybrid SQL을 복제하되 `ai.annotation_snapshot` 대상, 파라미터 `(curriculum_id, session_id, max_session_ms | NULL, top_k)`로 §4 시점 규칙 구현(NULL이면 시간 필터 없음=live). `app/retrieval/`에 `AnnotationHit` 모델·`AnnotationSearchPort`·recent-window 조회(`session_ms` 내림차순 N개, 유사도 무관 §5-1) 추가 | 격리 pgvector 테스트: 커리큘럼 스코프, v2 시점 필터(이후 스냅샷 제외), DELETED 제외, recent-window 순서 | W1 (스키마만) |
| **A2** | `ANNOTATION` source 모델 | `ai-api/app/rag/models.py` — `AnnotationSource`(v1, excerpt optional)·`AnnotationSourceV2`(excerpt 필수 ≤300자)를 §6 형태로 추가, `AnswerSource`/`AnswerSourceV2` union 확장. `rag/sse.py` 인코딩 경유 확인 | source 스키마·SSE 직렬화 계약 테스트. union 추가는 additive라 기존 테스트 무회귀 | 없음 |
| **A3** | retriever 결합·배선 | `ai-api/app/rag/retrieval.py` — `CombinedEvidenceRetriever`(v1)·`ReplayEvidenceRetriever`(v2)에 annotation 병렬 검색(Top-2) + recent window(기본 5) 주입, `snapshotId` 중복 제거, sufficiency 산입(§4). `wiring.py`의 `build_rag_services`/`build_replay_rag_services`에 어댑터 조립, `config.py`에 `AI_API_ANNOTATION_*`(top_k·window N·문자 예산) | retriever 단위 테스트: 자료 0+annotation 1이어도 sufficient, 두 경로 중복 제거, v2에서 질문 시점 이후 제외. annotation 미조립(설정 없음) 시 기존 동작 그대로 | A1·A2 |
| **A4** | 프롬프트 시각 렌더 | `ai-api/app/adapters/gms_openai_answer.py`·`gms_openai_answer_v2.py` — annotation 근거를 `[강조 mm:ss]` 접두로 렌더, v2는 질문 시점(`questionSessionMs`→mm:ss)도 문맥에 명시(§5-2). citation 규칙은 불변 | 프롬프트 조립 단위 테스트(시각 포맷·근거 순서). "아까" 계열 질문 수동 스모크 1회 기록 | A3 |
| **D1** | 계약 문서 동반 갱신 | W2 머지 MR에서 루트 [`docs/CONTRACT.md`](../../CONTRACT.md) §3-1(잡 wire)·§3-2(콜백), A2 머지 MR에서 sources 스키마, 각 MR에서 [`docs/ai/CONTRACT.md`](../../ai/CONTRACT.md) §7 상태표와 `ai-worker/CONTRACT.md`·`ai-api/CONTRACT.md`·각 README | 문서 링크 검사 통과. 별도 슬라이스가 아니라 **해당 구현 MR에 동반**(AGENTS §7 동반 수정) | 각 슬라이스 |
| **E1** | E2E 수용 | Spring outbox 구현 이후 dev 스택에서 아래 게이트 시나리오 1→2→3→4 순서로 실행, 결과를 이 ADR에 추기 | 시나리오 4개 통과 | W5·A4 + Spring |

각 슬라이스의 공통 검증은 해당 서비스에서
`uv run --frozen pytest -q -p no:cacheprovider` · `uv run --frozen ruff check app tests`다.

### 진행 상태 (2026-08-04)

W1~W5·A1~A4는 구현·검증 완료다(ai-worker 409 passed, ai-api 377 passed, 양쪽 ruff 통과).
남은 것은 **E1뿐이며 Spring outbox 구현에 막혀 있다.** 구현하며 계획에서 달라진 점:

- 스위치가 꺼진 annotation 잡은 DLQ에 보존한다. "ACK도 requeue도 하지 않는 보존"은 RabbitMQ에
  없고 requeue는 재전달 루프를 만든다. 스위치를 켠 뒤 DLQ 재발행으로 회수하므로 유실은 없다.
- `ANNOTATION_EMBED_DELETE`는 callback을 보내지 않는다. ADR-0074가 정의한 eventType 3종이 모두
  색인용이라 삭제 성공을 알릴 값이 없고, `ANNOTATION_EMBEDDED/READY`를 재사용하면 삭제된
  스냅샷을 "색인됨"으로 알리게 된다. **삭제 결과 확인이 필요하면 오너 합의로 eventType을 먼저
  추가해야 한다 — Spring 오너에게 전달할 열린 항목이다.**
- 라이브 프롬프트에는 `askedAt`을 넣지 않는다(§5-2 참조).
- ai-api는 `AI_API_ANNOTATION_EVIDENCE_ENABLED`, ai-worker는
  `AI_WORKER_ANNOTATION_INGESTION_ENABLED`로 각각 독립 제어하며 둘 다 기본 off다.

**권장 진행 순서(1인 기준)**: W1 → W2(+D1) → A2(+D1) → A1 → W3 → W4 → W5 → A3 → A4 → E1.
스키마와 wire를 먼저 확정해야 Spring 오너가 outbox를 병행 착수할 수 있고, A2까지 나가면 FE
오너가 근거 렌더를 병행할 수 있다 — 팀 병렬화가 가장 빨리 열리는 순서다.

## 계약·완료 게이트

- 잡 wire(`ANNOTATION_EMBED`·`ANNOTATION_EMBED_DELETE`)와 콜백 eventType, sources union 변경은
  Java 공유 계약이다. 구현 MR에서 루트 [`docs/CONTRACT.md`](../../CONTRACT.md) §3-1·§3-2와
  [`docs/ai/CONTRACT.md`](../../ai/CONTRACT.md) §7 상태표, 양쪽 계약 테스트를 함께 갱신한다.
- 계약 테스트 대상: 잡 파싱(worker), 콜백 payload, v1/v2 `ANNOTATION` source 스키마,
  v2 시점 필터(`session_ms <= questionSessionMs`), 멱등 재발행·삭제.
- E2E 수용 시나리오:
  1. `ANNOTATION_EMBED` 발행 → 색인 → `ANNOTATION_EMBEDDED` 콜백.
  2. 같은 세션에서 "아까 강조하신 게 뭐였지?" 질의 → recent window 경유로 최신 스냅샷이
     문맥에 포함 → 답변 `sources`에 `ANNOTATION` + `sessionMs`.
  3. 다시보기에서 질문 시점 *이후* 스냅샷은 근거에 나오지 않는다.
  4. `ANNOTATION_EMBED_DELETE` 후 같은 질의에서 해당 스냅샷이 근거로 나오지 않는다.

## 결과

- 강사의 강조 행위가 `(sessionMs, 내용 텍스트, 임베딩)`으로 영속되어 시간 질의와 의미 질의를
  모두 근거로 답할 수 있다.
- 자료 색인 스키마와 근거 모델을 오염시키지 않고 source 종류 하나로 확장된다.
- 시간 이해를 모델의 시각 비교로 위임해 MVP 기간에 파서·평가셋 부채를 만들지 않는다.
- 텍스트화 실패가 명시적 FAILED로 드러나 "색인된 척"하는 조용한 공백이 없다.

## 참고

- [songjeongki/ADR-0074 — 강조 판서 근거 계약 요청](../songjeongki/0074-annotation-highlight-evidence-contract.md)
- [ADR-0042 — 다시보기 자막 근거 계약](0042-replay-ai-caption-context-contract.md)
- [ADR-0037 — AI 로드맵·평가 게이트](0037-ai-roadmap-and-evaluation-gates.md)
- [ADR-0015 — RAG 색인 shadow version 저장](0015-rag-index-shadow-version-storage.md)
- [jinwoo/ADR-0007 — 커리큘럼 스코프 자료 공유](../jinwoo/0007-curriculum-scoped-rag-material-sharing.md)
