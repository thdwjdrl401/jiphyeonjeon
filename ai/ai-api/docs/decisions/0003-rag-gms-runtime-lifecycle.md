# ADR-0003: grounded GMS stream, request registry와 process lifecycle

- 상태: 채택(AI 내부), Spring 인증 계약은 후보
- 일자: 2026-07-27
- 범위: `ai/ai-api`

## 맥락

RAG core와 Redis/pgvector/BGE context adapter가 분리됐지만 답변 model, 중복 요청 제어와 application
lifespan 연결이 없었다. 원본 MVP에는 GMS adapter와 고정 Bearer secret이 함께 있었는데, 고정 secret은
Spring→AI 단명 JWT 방향과 맞지 않아 그대로 이식할 수 없다.

## 결정

1. GMS OpenAI-compatible gateway URL은 코드에 고정하고 API key만 `SecretStr` 설정으로 주입한다. SDK 자동
   retry는 끄고 service timeout보다 짧은 client timeout을 둔다.
2. GMS에는 질문과 선택된 근거, page/time 좌표만 JSON으로 보낸다. request/session/material/attempt ID는
   prompt에서 제외하고 강의 내용의 prompt injection을 따르지 말라는 system 규칙을 둔다.
3. provider text는 10,000자 이하 delta로 나누고 timeout·rate limit·인증·설정·연결 오류를 안정된
   `MODEL_*` code로 바꾼다. 취소 시 provider stream과 client를 닫는다.
4. `requestId`는 SSE header 전에 process-local bounded registry에서 확보한다. active/recent 중복은 `409`,
   active 용량 초과는 `503`이며 terminal·오류·client 취소 모두 recent 상태로 이동한다.
5. FastAPI lifespan이 caption consumer 하나를 시작·drain하고 GMS/BGE client와 DB engine을 닫는다.
   `/readyz`는 기존대로 dependency health가 아니라 application lifespan만 뜻한다.
6. 실제 Spring 단명 토큰 verifier는 구현하지 않는다. 고정 token fallback 없이 인증 seam을 `503`으로
   유지하고 Java claim 합의와 양측 계약 테스트를 common gate로 남긴다.

## 결과와 후속

- AI 단독으로 context→GMS→SSE와 자원 종료를 fake 인증기로 검증할 수 있다.
- 기본 registry는 한 process 안에서만 유효하다. multi-replica 배포 전 공유 registry·TTL·재연결 replay
  정책을 확정해야 한다.
- 실제 GMS credential smoke, Spring JWT verifier와 Spring proxy E2E는 이 MR의 완료 주장에 포함하지 않는다.

## 후속 (2026-07-28) — 인증 방식은 HMAC으로 확정, JWT 아님

이 ADR 작성 시점엔 Spring→AI 인증이 단명 JWT로 갈 것을 가정했지만(§6 "실제 Spring 단명 토큰 verifier는
구현하지 않는다"), 이후 ADR-0023 §9에서 Spring 담당(송정기)이 기존 `AiCallbackVerifier`와 같은 HMAC
공유 시크릿 방식을 역제안했고 **채택이 확정됐다**([jinwoo/0001](../../../../docs/decisions/jinwoo/0001-spring-ai-rag-s2s-auth-approval.md)).
`app/adapters/hmac_internal_authenticator.py`가 실제 검증기이며, `AI_INTERNAL_SECRET` 설정 시
`main.py`가 배선한다. 위 §6의 "고정 secret 검증을 넣지 않는다"는 방침은 이 결정으로 대체됐다 — 지금은
고정 공유 시크릿(HMAC)이 채택된 방식이다. Spring 쪽 서명 발급기는 여전히 미구현이라 fail-closed `503`
경로 자체는 유지된다.
