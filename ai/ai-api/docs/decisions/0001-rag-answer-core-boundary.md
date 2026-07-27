# ADR-0001: port 기반 RAG SSE 수직 코어와 fail-closed 인증 seam

- 상태: 채택(AI 내부), Spring wire 계약은 후보
- 일자: 2026-07-27
- 범위: `ai/ai-api`

## 맥락

원본 MVP 브랜치에는 Redis, pgvector, embedding, GMS와 HTTP가 한꺼번에 연결된 RAG 구현이 있다. 이를 최신
master에 그대로 옮기면 외부 adapter 실패와 요청/SSE 계약 실패를 분리해 검증하기 어렵다. 또한 기존 실험의
고정 Bearer secret은 루트 ADR-0014가 정한 Spring→AI 단명 서명 토큰 방향과 맞지 않지만, 실제 Java claim
규약도 아직 구현되지 않았다.

## 결정

1. 먼저 `RagAnswerRequest -> EvidenceRetriever -> AnswerModel -> terminal SSE` 수직 흐름을 만든다.
2. retrieval과 model은 Python protocol로 두고 Redis/pgvector/BGE/GMS는 후속 MR에서 adapter로 채운다.
3. PPTX의 lesson scope와 caption의 session scope를 application core가 adapter 결과에 대해 다시 검증한다.
4. 충분한 근거가 없으면 model을 호출하지 않는다. 시작된 stream은 정상 상황에서 terminal event 하나로 끝낸다.
5. HTTP adapter는 내부 인증 protocol만 의존한다. 실제 검증기가 없으면 `503`으로 닫고 임시 고정 secret을
   production 설정에 추가하지 않는다.
6. 후보 wire shape는 서비스 로컬 `CONTRACT.md`와 계약 테스트로 고정하되 Java 공유 계약이라고 부르지 않는다.

## 결과

- fake port만으로 request, citation, timeout, failure sanitization, cancellation과 SSE framing을 검증할 수 있다.
- 실제 adapter를 하나씩 추가해도 HTTP/stream 계약과 application core를 다시 작성하지 않는다.
- 현재 entrypoint의 RAG API는 의도적으로 사용 불가다. production 활성화에는 retrieval/model/auth wiring이
  모두 필요하다.
- request 중복 방지와 multi-replica 상태는 GMS/runtime wiring 단계에서 추가한다.

## Java 채택 gate

Spring 담당자와 단명 토큰 claim, 외부 proxy request/event, session clock을 합의한 뒤 공유
`docs/CONTRACT.md`, Java 계약 테스트와 이 후보 계약을 같은 common MR에서 갱신한다.
