# `ai-api/app/api`

FastAPI transport가 RAG application core를 호출하는 내부 HTTP adapter다.

## 역할

- `POST /internal/v1/rag/answers:stream`의 header와 body 경계를 검증한다.
- 주입된 `InternalRequestAuthenticator`로 Spring 호출을 인증한다.
- RAG event iterator를 buffering 금지 SSE 응답으로 전달한다.

## 파일 구성

| 파일 | 책임 |
|---|---|
| `internal_auth.py` | 실제 단명 토큰 검증기를 위한 인증 port와 실패 타입 |
| `rag.py` | 인증·Accept·상태코드·StreamingResponse adapter |

## 경계와 불변식

- 브라우저가 직접 호출하는 API가 아니다.
- 인증기 미배선은 `503`, 인증 실패는 `401`, SSE Accept 누락은 `406`, body 위반은 `400`이다.
- active/recent `requestId` 중복은 SSE header 전에 `409`, process-local active 한도 초과는 `503`이다.
- 고정 secret 검증을 임시로 넣지 않는다. Spring 토큰 claim이 합의되면 별도 adapter로 구현한다.
- retrieval/model 실패는 HTTP status를 뒤집지 않고 계약화된 terminal SSE event로 표현한다.
