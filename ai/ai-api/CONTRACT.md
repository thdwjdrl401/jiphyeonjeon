# ai-api AI-side contract

이 문서는 Python `ai-api`가 구현하고 테스트하는 상세 검증 규칙이다. Java/Spring과 공유하는 wire 정본은
[`docs/CONTRACT.md`](../../docs/CONTRACT.md)이며 충돌하면 공유 계약이 우선한다. 각 경계의 구현 상태도 공유
계약과 [AI 통신 계약 지도](../../docs/ai/CONTRACT.md)를 따른다.

## 1. 내부 HTTP 경계

- 요청: `POST /internal/v1/rag/answers:stream`
- 호출자: 사용자 인증·강의 권한·비용 정책을 먼저 확인한 Spring만 허용한다.
- 요청 header: `X-Internal-Signature: base64(HMAC-SHA256(AI_INTERNAL_SECRET, rawBody))` (ADR-0023 §9,
  Spring↔ai-api 공유 시크릿). 서명 대상은 요청 원시 body 전체다.
- 응답 협상: `Accept`에 `text/event-stream`이 포함되어야 한다.
- 브라우저의 직접 호출은 지원하지 않는다.

`AI_INTERNAL_SECRET`이 설정되면 production entrypoint는 이 HMAC 인증기를 실제로 배선한다. 미설정 시에는
`503`으로 닫힌다(fail-closed). Spring signer와 browser-facing SSE proxy까지 구현됐으며 공유 wire 정본은
[`docs/CONTRACT.md` §3-9](../../docs/CONTRACT.md#3-9-spring--ai-api-rag-sse-http-hmac-서명--양쪽-구현됨)다.

## 2. 요청 body

```json
{
  "requestId": "request-1",
  "lessonId": "11111111-1111-4111-8111-111111111111",
  "curriculumId": "55555555-5555-4555-8555-555555555555",
  "sessionId": "33333333-3333-4333-8333-333333333333",
  "question": "방금 설명한 개념은 무엇인가요?",
  "contextTimeMs": 615000,
  "issuedAtMs": 1785120000000
}
```

- JSON field는 camelCase이며 정의하지 않은 field를 거부한다.
- `requestId`: 1~128자. 한 process의 active/recent registry에서 SSE 시작 전에 확보한다. terminal·오류·client
  취소 뒤에도 bounded recent 목록에 남으며 같은 ID는 `409`다. replay 가능한 멱등 응답 key는 아니다.
- `lessonId`: 소문자 canonical UUID. 자막(caption) evidence가 이 lesson·session scope임을 내부에서
  검증한다.
- `curriculumId`: 소문자 canonical UUID. PPTX material evidence가 이 curriculum scope임을 내부에서
  검증한다(ADR-0007) — 같은 curriculum의 다른 lesson에 업로드된 자료도 검색 대상이 된다. Spring이
  아직 이 field를 보내지 않으면 요청 자체가 `400`으로 거부된다.
- `sessionId`: 소문자 canonical UUID. 모든 자막 evidence가 이 session scope여야 한다.
- `question`: 1~4,000자. whitespace를 임의로 trim하지 않는다.
- `contextTimeMs`: 0 이상의 **최신 STT attempt-local `streamElapsedMs` 좌표**다. Spring은 자신의
  session/HLS clock을 이 좌표로 변환한 뒤 보내야 하며, 변환 기준점은 공유 계약 승격 전에 확정해야 한다.
- `issuedAtMs`: 0 이상의 UTC epoch ms. `X-Internal-Signature` 검증 시 신선도 체크에 쓰인다 — 서버 수신
  시각과 60초 이상 차이 나거나 5초를 초과해 미래면 `401`. body가 곧 서명 대상이라 별도 claim 없이 이 값
  자체가 위·변조되면 서명 검증에서 걸린다.

## 3. SSE event

각 frame은 named event와 한 줄 JSON data로 구성한다.

```text
event: answer.delta
data: {"requestId":"request-1","text":"RAG는 "}

```

| event | data | 의미 |
|---|---|---|
| `answer.delta` | `{requestId,text}` | 0개 이상의 답변 조각 |
| `answer.done` | `{requestId,sources}` | 근거가 있는 정상 종료 |
| `answer.insufficient` | `{requestId,message}` | 답할 근거가 없어 모델을 호출하지 않음 |
| `answer.error` | `{requestId,code,message,retryable}` | timeout 또는 정제된 내부 실패 |

`answer.done.sources`는 1개 이상이며 최초 evidence 순서를 보존하고 중복 제거한다.

```json
{"type":"PPTX","materialId":"22222222-2222-4222-8222-222222222222","page":4}
```

```json
{"type":"CAPTION","sessionId":"33333333-3333-4333-8333-333333333333","sttSessionId":"stt-attempt-2","startMs":55000,"endMs":59000}
```

```json
{"type":"ANNOTATION","highlightId":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","sessionId":"33333333-3333-4333-8333-333333333333","sessionMs":725300,"excerpt":"B+ tree 노드 분할 조건"}
```

`ANNOTATION`은 강사 강조 판서 근거다([ADR-0043](../../docs/decisions/canola/0043-annotation-timeline-evidence-mvp.md)).
`sessionMs`는 다시보기 타임라인 앵커이며 client가 그 시점으로 이동하는 데 쓴다. 스냅샷에는 page가 없으므로
`PPTX`로 표현하지 않는다. 중복 제거 키는 `highlightId`다. v1에서 `excerpt`는 다른 v1 source와 같이 optional이다.

annotation 근거는 `AI_API_ANNOTATION_EVIDENCE_ENABLED`(기본 `false`)일 때만 검색한다. 꺼져 있으면 두 RAG
경로가 이 기능이 생기기 전과 완전히 동일하게 동작한다. 켜지면 자료 검색과 **병렬로** 두 종류를 읽는다.

| 읽기 | 기준 | 기본값 |
|---|---|---|
| 의미 검색 | 자료와 같은 RRF hybrid, `curriculumId` 스코프 | `AI_API_ANNOTATION_TOP_K` = 2 |
| recent window | 유사도 무관, 같은 `sessionId`의 최근 `sessionMs` 순 | `AI_API_ANNOTATION_WINDOW_SIZE` = 5 |

window가 별도로 필요한 이유는 "아까 강조하신 게 뭐였지" 같은 시간 지시어가 임베딩 공간에 방향을 갖지
않기 때문이다. 의미 검색만으로는 어떤 임계값을 써도 걸리지 않는다. 두 읽기 결과는 `highlightId`로 중복
제거하며 window가 앞선다. 근거 순서는 자료 → 판서 → 자막이고, 판서만 있어도 `sufficient`다.

시점 필터는 다시보기에만 적용한다. v2는 질문자 자신의 세션에서 `sessionMs <= questionSessionMs`인
스냅샷만 쓰고 다른 세션은 전부 허용한다(이미 끝난 강의라 전체가 과거다). v1은 필터가 없다 — 색인된
스냅샷은 정의상 질문 이전이고, `contextTimeMs`는 STT attempt-local이라 `sessionMs`와 비교할 수 없다.

모델 프롬프트에는 annotation 근거마다 `highlightedAt`(`mm:ss`, 한 시간 초과 시 `h:mm:ss`)과 원본
`sessionMs`가 들어간다. v2는 질문 시점을 `askedAt`으로 함께 주고 v1은 주지 않는다 — attempt-local
시간을 세션 시각처럼 제시하면 모델이 서로 다른 타임라인을 비교하게 된다. `highlightId`는 프롬프트에
넣지 않는다(출처는 서버가 붙인다). 이 필드들은 SSE wire 계약이 아니라 모델 입력이다.

한 stream은 `answer.delta` 0개 이상 뒤 `answer.done|answer.insufficient|answer.error` 중 정확히 하나로 끝난다.
client disconnect/cancellation 때는 terminal event 생성을 강제하지 않고 내부 iterator까지 취소를 전파한다.

## 4. HTTP 상태코드

| 상태 | 조건 |
|---:|---|
| `200` | 인증·Accept·body 검증 후 SSE 시작 |
| `400` | 요청 body가 계약을 위반 |
| `401` | 구성된 내부 인증기가 호출자를 거부 |
| `409` | active/recent `requestId` 재사용 |
| `406` | `Accept: text/event-stream` 미포함 |
| `503` | 인증기/RAG service 미배선 또는 process-local active request 한도 초과 |

SSE header가 시작된 뒤의 retrieval/model 실패는 HTTP 상태를 바꾸지 않고 `answer.error`로 전달한다.

## 5. realtime-agent 자막 입력 계약

ai-api는 realtime-agent의 `caption-stream-entry.schema.json`과 fixture를 직접 테스트 기준으로 사용한다.

- transport: application Redis stream, 기본 key `ai:captions:live`
- delta: `caption.delta` + `eventId/lessonId/sessionId/sttSessionId/sequence/streamElapsedMs/text/occurredAt`
- terminal: `caption.stream.completed` + 같은 scope + `lastSequence/reason=ROOM_DELETED/occurredAt`
- `sequence`와 `streamElapsedMs`는 session 전체가 아니라 `(sessionId, sttSessionId)` attempt 안에서 증가한다.
- 새 `sttSessionId`는 새 attempt이므로 이전 자막 문맥을 교체하고 `sequence=1`을 허용한다.
- ai-api는 RAG용 `ai-rag-live-v1`과 강의 노트용 `ai-live-notes-mvp-v1`을 사용한다. 두 group은
  Spring consumer group과 분리하며 handler의 durable 반영 뒤에만 ACK한다.
- Redis endpoint는 `AI_API_REDIS_URL`로 주입하며 기본 개발값은 `redis://127.0.0.1:6379/0`이다.
  LiveKit 내부 Redis 포트 `6380`으로 고정하지 않는다.

이 경계의 Java 공유 정본은 [`docs/CONTRACT.md` §3-4](../../docs/CONTRACT.md#3-4-realtime-agent--application-redis-자막-stream--ai-구현됨-spring-consumer-구현adr-0043)다.
payload나 시간축 규칙을 바꾸면 Python·Java 구현과 양쪽 계약 테스트를 같은 변경에서 갱신한다.

## 5-1. 실시간 강의 노트 Redis 출력 계약

Java와 공유하는 wire 정본은 [`docs/CONTRACT.md` §3-4a](../../docs/CONTRACT.md#3-4a-ai-api--application-redis-실시간-강의-노트-stream--ai-producer-구현-spring-consumer-미구현)다.
ai-api는 application Redis의 `ai:lecture-notes:mvp`에 다음 세 event를 발행한다.

- `lecture.note.chunk.appended`: 새 topic 또는 새 key point와 append 가능한 `markdownFragment`
- `lecture.note.capture.completed`: 자막 수집 종료와 마지막 chunk/STT sequence
- `lecture.note.refined.snapshot`: 종료 후 정제한 전체 `topics`와 `markdownSnapshot`

Python 구현은 `extra="forbid"` Pydantic event model로 필수 필드·literal·UUID·identifier·숫자 문자열·길이와
timezone offset을 검증한다. `keyPoints`와 refined `topics`는 Redis에서 compact JSON 문자열로 직렬화하고
나머지 값은 문자열로 싣는다. Redis publisher는
`XADD MAXLEN ~ AI_API_LECTURE_NOTE_STREAM_MAXLEN`(기본 10,000)을 사용한다. 라이브 중에는 이전 전체 노트를
반복 발행하지 않고, capture 완료 뒤에만 별도 refined snapshot 전체본을 한 번 발행한다.

같은 세션의 모델 호출과 event 발행은 process 안에서 직렬화한다. 실제 추가 요점이 없는 모델 결과는
`chunkSequence`를 올리거나 빈 event를 발행하지 않는다. 첫 조각의 유효 `topicAction`은 `START_NEW`이며,
completion은 마지막 남은 window의 chunk 발행이 성공한 뒤에만 발행한다.

window·note·미처리 batch·outbox는 Redis session checkpoint에 저장하고 단일 ai-api 프로세스 재시작 때
복원한다. 결과 `XADD`와 다음 checkpoint는 한 Redis transaction으로 확정한다. Redis 자체 장애 내구성,
same-process bounded retry, multi-replica session owner는 아직 보장하지 않는다. Spring consumer는
`lecture.note.chunk.appended`를 누적하고 capture 완료를 확인한 뒤, refined snapshot을 별도 read model
전체 교체로 반영해야 한다. 세부 순서·멱등·ACK 규칙은 공유 계약 §3-4a를 따른다.

## 6. 자료 검색과 BGE 경계

- pgvector 검색은 요청 `curriculumId`와 `ai.material_version.state='ACTIVE'`를 SQL에서 강제한다
  (ADR-0007 — lesson이 아니라 curriculum 전체가 검색 스코프다).
- runtime DB role은 안전한 identifier만 허용하며 production에서는 read-only 권한으로 제공해야 한다.
- query embedding은 인증된 `POST /internal/v1/embeddings`를 호출한다.
- 요청은 고정 `model=BAAI/bge-m3`, full revision, 단일 text를 전달한다.
- 응답은 같은 model/revision, `dimensions=1024`, `normalized=true`, 유한한 단위 벡터 하나여야 한다.
- material evidence는 현재 vector similarity `0.25` 이상 또는 lexical score `0` 초과일 때 채택한다.
  이 값은 MVP 기본값이며 실제 평가 corpus로 조정할 설정값이다.
- 자막 evidence는 최신 attempt에서 `contextTimeMs` 이전의 제한된 event와 문자 수만 사용한다.

## 7. GMS 답변과 process lifecycle

- 답변은 고정 GMS OpenAI-compatible gateway로 보내며 API key만 `AI_API_GMS_API_KEY`로 주입한다.
- SDK 자동 retry는 0이다. GMS client timeout은 전체 model timeout보다 짧게 검증한다.
- prompt에는 `question`, 선택된 evidence 내용과 PPTX page 또는 caption time 좌표만 포함한다.
  `requestId/sessionId/materialId/sttSessionId`는 provider에 보내지 않는다.
- system prompt는 question/evidence 안의 지시를 신뢰하지 않고 제공된 강의 근거만 사용하도록 고정한다.
  이전 대화 turn이 이어져도(같은 사용자·같은 세션) 사실 근거는 이번 evidence만 쓰도록 명시한다 —
  turn을 실제로 이어붙이는 기능은 §7-1을 따른다.
- prompt 문자 수와 output token 수를 설정 상한으로 제한하고 provider delta는 최대 10,000자로 나눈다.
- GMS timeout·rate limit·연결·인증·설정 실패는 secret과 provider body를 제외한 `MODEL_*` code로 변환한다.
- FastAPI lifespan은 caption consumer 하나를 시작·drain하고 GMS/BGE client와 DB engine을 닫는다.
- `/readyz`는 외부 dependency health가 아니라 application lifespan 준비 상태만 나타낸다.

## 7-1. 대화 이어가기 (GMS Responses API, ADR-0010)

v1 `/internal/v1/rag/answers:stream` 요청 body는 `userId`, `conversationId`(둘 다 optional, 미지정
시 기존과 완전히 동일하게 동작)를 추가로 받는다. **Spring은 아직 이 두 필드를 보내지 않는다** — 이
절은 ai-api가 두 필드를 받았을 때 무엇을 하는지 설명하며, 언제 Spring이 보내기 시작할지는 별도
합의 대상이다.

- 두 필드가 모두 있는 요청만 대화 기억이 활성화된다. 하나라도 없으면 §7의 기존 Chat Completions
  경로를 그대로 타서 동작이 전혀 바뀌지 않는다.
- 활성화되면 ai-api가 Redis(`AI_API_REDIS_URL`, key prefix `AI_API_CONVERSATION_MEMORY_KEY_PREFIX`
  기본 `ai:conversation:`)에서 `{userId}:{sessionId}:{conversationId}` 키로 직전 GMS
  `previous_response_id`를 조회한 뒤, GMS **Responses API**(`POST /responses`, Chat Completions가
  아님)를 `previous_response_id`와 함께 호출한다. 응답이 끝나면 새 `response_id`를 같은 키로 저장한다
  (TTL `AI_API_CONVERSATION_MEMORY_TTL_SECONDS` 기본 1,800초, 매 turn 갱신 — TTL 만료가 "대화 종료"
  판정이다).
- `userId`/`conversationId`는 **provider(GMS)에 절대 보내지 않는다** — Redis 조회 키로만 쓰고, GMS에는
  조회로 찾은 `response_id`(provider가 발급한 값)만 전달한다. §7의 "내부 ID를 provider에 보내지
  않는다" 원칙과 동일하다.
- Redis 조회·저장 실패는 대화 이어가기만 건너뛰고 답변 스트림 자체는 항상 정상 진행한다(fail-open).
- 적용 범위는 v1(Live)뿐이다. v2(Replay)는 ADR-0037이 "서버 대화 기억"을 명시적으로 범위 밖에
  뒀으므로 이 기능이 없다.
- 실제 GMS Responses API 스트리밍 이벤트 형태(`response.created`/`response.output_text.delta`/
  `response.completed`)는 2026-08-03 실측 검증됨 — 자세한 내용은
  [ADR-0010](../../docs/decisions/jinwoo/0010-gms-responses-api-conversation-memory.md) 참고.

## 8. Replay(v2) 내부 HTTP 경계

ADR-0037([`docs/decisions/canola/0042-replay-ai-caption-context-contract.md`](../../docs/decisions/canola/0042-replay-ai-caption-context-contract.md))과
[ADR-0008(구현 설계, jinwoo)](../../docs/decisions/jinwoo/0008-replay-rag-answer-v2-endpoint.md)에 따라
다시보기(Replay) 질문 전용 `POST /internal/v2/rag/answers:stream`을 별도 경로로 추가했다. 위 §1~§7의
v1 endpoint(`/internal/v1/rag/answers:stream`)는 이 절 때문에 요청·응답·시간 의미가 전혀 바뀌지 않는다.

- 인증: v1과 동일한 `X-Internal-Signature` HMAC 검증(같은 `AI_INTERNAL_SECRET`, 같은 신선도 규칙)을 재사용한다.
- 요청 body는 `contextTimeMs` 대신 `context: {mode:"REPLAY", questionSessionMs, captions[]}`를 쓴다.
  `captions[]`는 Spring이 이미 세션 시간으로 변환한 확정 자막이며, ai-api는 caption을 다시 조회하지 않는다.
- material(PPTX) 검색은 v1과 동일한 pgvector 경로·threshold·`curriculumId` 스코프를 그대로 재사용한다.
- caption evidence는 `captions[]`를 하나로 병합해 **CAPTION source 최대 1개**만 만든다(ADR-0037).
- `answer.done.sources`는 v1과 달리 각 source에 원문 그대로의 plain-text `excerpt`(최대 300자)를 포함한다.
  CAPTION source는 `sttSessionId`를 포함하지 않는다(v1 `CaptionSource`와 다른 점).
- source 중복 제거는 `(materialId,page)` / `(sessionId,startSessionMs,endSessionMs)` / `highlightId` 키로만
  판단하고 `excerpt` 차이는 dedup에 영향을 주지 않는다.
- `ANNOTATION` source는 v1과 같은 필드를 쓰되 `excerpt`가 **필수**다(다른 v2 source와 동일).
- SSE event 종류·상태코드·에러 코드 체계는 v1과 동일하다.

## 9. 후속 미확정 사항

- Spring→AI 단명 토큰의 algorithm, issuer, audience, scope, clock skew
- Java session/HLS clock과 realtime-agent `streamElapsedMs`의 변환 기준점
- request 재연결/replay 정책과 multi-replica 공유 registry·recent TTL
- multi-replica 자막 context 공유, abandoned Redis PEL claim, stream retention
- retrieval threshold와 GMS model 품질 평가
