# ai-api RAG answer AI-side contract

이 문서는 Python `ai-api`가 구현하고 테스트하는 **AI-side 후보 계약**이다. Java/Spring이 채택한 공유
`docs/CONTRACT.md`의 확정 내부 계약은 아니며, Spring proxy 구현과 양쪽 계약 테스트가 준비되면 common MR에서
공유 계약으로 승격한다.

## 1. 내부 HTTP 후보 경계

- 요청: `POST /internal/v1/rag/answers:stream`
- 호출자: 사용자 인증·강의 권한·비용 정책을 먼저 확인한 Spring만 허용한다.
- 요청 header: `Authorization`. 토큰 claim과 서명 방식은 아직 확정하지 않았다.
- 응답 협상: `Accept`에 `text/event-stream`이 포함되어야 한다.
- 브라우저의 직접 호출은 지원하지 않는다.

현재 production entrypoint에는 인증기와 RAG service가 배선되지 않아 `503`으로 닫혀 있다. 이 문서의 adapter와
테스트가 통과해도 Spring 인증·GMS 답변 생성·application lifespan 연결이 완료된 것은 아니다.

## 2. 요청 body

```json
{
  "requestId": "request-1",
  "lessonId": "11111111-1111-4111-8111-111111111111",
  "sessionId": "33333333-3333-4333-8333-333333333333",
  "question": "방금 설명한 개념은 무엇인가요?",
  "contextTimeMs": 615000
}
```

- JSON field는 camelCase이며 정의하지 않은 field를 거부한다.
- `requestId`: 1~128자. 현재 tracing key이며 중복 방지는 후속 request registry가 맡는다.
- `lessonId`: 소문자 canonical UUID. 모든 PPTX와 자막 evidence가 이 lesson scope임을 내부에서 검증한다.
- `sessionId`: 소문자 canonical UUID. 모든 자막 evidence가 이 session scope여야 한다.
- `question`: 1~4,000자. whitespace를 임의로 trim하지 않는다.
- `contextTimeMs`: 0 이상의 **최신 STT attempt-local `streamElapsedMs` 좌표**다. Spring은 자신의
  session/HLS clock을 이 좌표로 변환한 뒤 보내야 하며, 변환 기준점은 공유 계약 승격 전에 확정해야 한다.

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

한 stream은 `answer.delta` 0개 이상 뒤 `answer.done|answer.insufficient|answer.error` 중 정확히 하나로 끝난다.
client disconnect/cancellation 때는 terminal event 생성을 강제하지 않고 내부 iterator까지 취소를 전파한다.

## 4. HTTP 상태코드

| 상태 | 조건 |
|---:|---|
| `200` | 인증·Accept·body 검증 후 SSE 시작 |
| `400` | 요청 body가 후보 계약을 위반 |
| `401` | 구성된 내부 인증기가 호출자를 거부 |
| `406` | `Accept: text/event-stream` 미포함 |
| `503` | 인증기 또는 RAG service 미배선 |

SSE header가 시작된 뒤의 retrieval/model 실패는 HTTP 상태를 바꾸지 않고 `answer.error`로 전달한다.

## 5. realtime-agent 자막 입력 계약

ai-api는 realtime-agent의 `caption-stream-entry.schema.json`과 fixture를 직접 테스트 기준으로 사용한다.

- transport: application Redis stream, 기본 key `ai:captions:live`
- delta: `caption.delta` + `eventId/lessonId/sessionId/sttSessionId/sequence/streamElapsedMs/text/occurredAt`
- terminal: `caption.stream.completed` + 같은 scope + `lastSequence/reason=ROOM_DELETED/occurredAt`
- `sequence`와 `streamElapsedMs`는 session 전체가 아니라 `(sessionId, sttSessionId)` attempt 안에서 증가한다.
- 새 `sttSessionId`는 새 attempt이므로 이전 자막 문맥을 교체하고 `sequence=1`을 허용한다.
- ai-api consumer group은 `ai-rag-live-v1`로 Spring consumer group과 분리한다. handler 반영 뒤에만 ACK한다.
- Redis endpoint는 `AI_API_REDIS_URL`로 주입하며 기본 개발값은 `redis://127.0.0.1:6379/0`이다.
  LiveKit 내부 Redis 포트 `6380`으로 고정하지 않는다.

이 경계는 AI 내부 후보 계약이다. Spring이 자막 stream을 직접 소비하거나 시간축을 변환할 때는
`docs/CONTRACT.md`와 양쪽 계약 테스트를 common MR에서 함께 갱신한다.

## 6. 자료 검색과 BGE 경계

- pgvector 검색은 요청 `lessonId`와 `ai.material_version.state='ACTIVE'`를 SQL에서 강제한다.
- runtime DB role은 안전한 identifier만 허용하며 production에서는 read-only 권한으로 제공해야 한다.
- query embedding은 인증된 `POST /internal/v1/embeddings`를 호출한다.
- 요청은 고정 `model=BAAI/bge-m3`, full revision, 단일 text를 전달한다.
- 응답은 같은 model/revision, `dimensions=1024`, `normalized=true`, 유한한 단위 벡터 하나여야 한다.
- material evidence는 현재 vector similarity `0.25` 이상 또는 lexical score `0` 초과일 때 채택한다.
  이 값은 MVP 기본값이며 실제 평가 corpus로 조정할 설정값이다.
- 자막 evidence는 최신 attempt에서 `contextTimeMs` 이전의 제한된 event와 문자 수만 사용한다.

## 7. 공유 계약 승격 전 미확정 사항

- Spring→AI 단명 토큰의 algorithm, issuer, audience, scope, clock skew
- Java session/HLS clock과 realtime-agent `streamElapsedMs`의 변환 기준점
- request 중복·재연결 정책과 multi-replica request registry
- multi-replica 자막 context 공유, abandoned Redis PEL claim, stream retention
- retrieval threshold 평가와 GMS prompt/model/provider
