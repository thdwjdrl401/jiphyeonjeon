# ai-api RAG answer AI-side contract

이 문서는 Python `ai-api`가 구현하고 테스트하는 **AI-side 후보 계약**이다. Java/Spring이 채택한 공유
`docs/CONTRACT.md`의 확정 세부 계약이 아니며 Spring proxy 구현 완료를 뜻하지 않는다. Java 채택 시 이
문서와 공유 계약, 양측 계약 테스트를 같은 common MR에서 맞춘다.

## 1. 내부 HTTP 후보 경계

- 요청: `POST /internal/v1/rag/answers:stream`
- 호출자: 사용자 인증·수강 권한·비용 정책을 먼저 확인한 Spring만
- 요청 header: `Authorization`은 주입된 내부 인증기가 검증한다. 토큰 claim/서명 방식은 아직 확정하지 않는다.
- 응답 협상: `Accept`에 `text/event-stream`이 포함되어야 한다.
- 브라우저 직접 호출은 지원하지 않는다.

현재 production entrypoint에는 인증기와 RAG adapter가 배선되지 않아 `503`으로 닫힌다. 테스트 전용 fake
port가 이 경계를 통과한다고 해서 Spring 인증 연동이 완료된 것은 아니다.

## 2. 요청 body

```json
{
  "requestId": "request-1",
  "lessonId": "11111111-1111-4111-8111-111111111111",
  "sessionId": "session-1",
  "question": "방금 설명한 개념은 무엇인가요?",
  "contextTimeMs": 615000
}
```

- JSON field는 camelCase이며 정의되지 않은 field를 거부한다.
- `requestId`: 1~128자, 현재 tracing key다. 중복 방지는 후속 request registry가 맡는다.
- `lessonId`: UUID. 모든 PPTX evidence의 저장 scope와 같아야 한다.
- `sessionId`: `[A-Za-z0-9._:-]{1,128}`. 모든 caption evidence의 scope와 같아야 한다.
- `question`: 1~4,000자. whitespace를 임의 trim하지 않는다.
- `contextTimeMs`: 0 이상의 session-relative millisecond 후보값이다. Java session clock 합의가 필요하다.

## 3. SSE event

각 frame은 named event와 한 줄 JSON data로 구성한다.

```text
event: answer.delta
data: {"requestId":"request-1","text":"RAG는 "}

```

event 종류:

| event | data | 의미 |
|---|---|---|
| `answer.delta` | `{requestId,text}` | 0회 이상 답변 조각 |
| `answer.done` | `{requestId,sources}` | 근거 있는 정상 종료 |
| `answer.insufficient` | `{requestId,message}` | 답변할 근거가 없어 모델을 호출하지 않음 |
| `answer.error` | `{requestId,code,message,retryable}` | timeout 또는 정제된 내부 실패 |

`answer.done.sources`는 1개 이상이며 최초 evidence 순서를 보존해 중복 제거한다.

```json
{"type":"PPTX","materialId":"22222222-2222-4222-8222-222222222222","page":4}
```

```json
{"type":"CAPTION","sessionId":"session-1","startMs":55000,"endMs":59000}
```

한 stream은 `answer.delta` 0회 이상 뒤 `answer.done|answer.insufficient|answer.error` 중 정확히 하나로 끝난다.
단, client disconnect/cancellation은 terminal event 생성을 강제하지 않고 내부 iterator에 취소를 전파한다.

## 4. HTTP 상태코드

| 상태 | 조건 |
|---:|---|
| `200` | 인증·Accept·body 검증 후 SSE 시작 |
| `400` | 요청 body가 후보 계약을 위반 |
| `401` | 구성된 내부 인증기가 호출자를 거부 |
| `406` | `Accept: text/event-stream` 미포함 |
| `503` | 인증기 또는 RAG service 미배선 |

SSE header가 시작된 뒤 retrieval/model 실패는 HTTP 상태를 바꾸지 않고 `answer.error`로 전달한다.

## 5. 아직 확정하지 않은 것

- Spring→AI 단명 토큰의 algorithm, issuer, audience, scope, clock skew
- Spring 외부 endpoint와 이 내부 endpoint 사이의 request/event 변환
- Redis caption time origin과 Java session clock 변환
- request 중복/재연결 정책과 multi-replica registry
- retrieval ranking, 충분성 기준, prompt와 model/provider
