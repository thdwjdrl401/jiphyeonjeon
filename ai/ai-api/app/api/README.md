# `ai-api/app/api`

FastAPI transport가 RAG application core를 호출하는 내부 HTTP adapter다.

## 역할

- `POST /internal/v1/rag/answers:stream`의 header와 body 경계를 검증한다.
- 주입된 `InternalRequestAuthenticator`로 Spring 호출을 인증한다.
- RAG event iterator를 buffering 금지 SSE 응답으로 전달한다.

## 파일 구성

| 파일 | 책임 |
|---|---|
| `internal_auth.py` | 인증 port(`raw_body`, `signature` 기반)와 실패 타입 — 실제 HMAC 구현체는 `app/adapters/hmac_internal_authenticator.py` |
| `rag.py` | 인증·Accept·상태코드·StreamingResponse adapter |

## 경계와 불변식

- 브라우저가 직접 호출하는 API가 아니다.
- 인증기 미배선은 `503`, 인증 실패는 `401`, SSE Accept 누락은 `406`, body 위반은 `400`이다.
- active/recent `requestId` 중복은 SSE header 전에 `409`, process-local active 한도 초과는 `503`이다.
- Spring→ai-api 인증은 HMAC 공유 시크릿(ADR-0023 §9, 채택 확정)으로 검증한다. `AI_INTERNAL_SECRET`이
  설정된 경우에만 `main.py`가 `HmacInternalRequestAuthenticator`를 실제로 배선한다.
- retrieval/model 실패는 HTTP status를 뒤집지 않고 계약화된 terminal SSE event로 표현한다.
