# ADR-0085: 대화 기억 보강 — 죽은 체이닝 포인터 복구와 세션 폴백 스위치

- **상태**: 구현됨
- **일자**: 2026-08-06
- **관련**: [jinwoo/ADR-0010](../jinwoo/0010-gms-responses-api-conversation-memory.md)(대화 기억),
  [canola/ADR-0046](0046-conversation-memory-session-default-scope.md)(userId 단독 활성)

## 배경 — 예고됐던 사고가 그대로 났다

Spring이 `userId`를 보내기 시작하면서(2026-08-05) 대화 기억이 운영에서 실제로 켜졌다. 그 직후
RAG 채팅에서 "모델 서비스 인증 설정을 확인해 주세요"(`MODEL_AUTH_FAILED`, 비재시도)가 관측됐다.

경로: 답변 성공 시 GMS response id가 Redis(TTL 30분)에 저장되는데, provider가 그 매핑을 잃으면
(재시작·키 로테이션 — 실측: GMS는 모르는 `previousId`에 **401** `No provider key mapping found`)
다음 질문의 체이닝 호출이 401 → `MODEL_AUTH_FAILED`로 **답변 전체가 죽는다**. 실패하면 새 id가
저장되지 않아 죽은 id가 남고, **그 사용자는 TTL이 끝날 때까지 모든 질문이 같은 오류**를 낸다.

ADR-0010과 0046 모두 "활성화 전 이 분기가 필요하다"고 적어뒀으나 Spring 배포가 먼저 나갔다.

## 결정

### 1. 죽은 체이닝 포인터는 버리고 재시도한다 (fail-open)

`previous_response_id`를 실은 첫 호출이 `MODEL_AUTH_FAILED`·`MODEL_CONFIGURATION_ERROR`로
실패하면 — 저장된 id를 Redis에서 지우고, 체이닝 없이 **한 번** 재시도한다.

- **delta가 하나라도 나간 뒤에는 재시도하지 않는다** — 클라이언트가 본문 일부를 받은 뒤 처음부터
  다시 스트리밍하면 답변이 중복된다. 401은 요청 시작 시점에 나므로 실무상 항상 delta 이전이다.
- **진짜 키 장애는 숨겨지지 않는다** — 재시도(체이닝 없음)도 같은 오류로 죽어 그대로 표면화된다.
- 삭제 실패는 답변을 막지 않는다(다음 turn이 같은 복구를 반복). 이벤트:
  `rag.conversation_chain_dropped`, `rag.conversation_memory_delete_failed`.
- 포트에 `delete_response_id` 추가(구현 필요 항목이 프로토콜에 늘어남 — 기존 어댑터는 Redis뿐).

### 2. 세션 폴백 스위치 (기본 off)

`AI_API_CONVERSATION_MEMORY_SESSION_FALLBACK_ENABLED=true`면 `userId` 없는 요청도
`("-", sessionId, "session")` 키로 대화를 잇는다.

- 용도: **질문자가 한 명뿐인 시연·단일 사용자 환경.** userId가 어떤 이유로든 빠져도 데모에서
  대화 이어가기가 동작해야 한다는 요구.
- **기본 off인 이유(ADR-0046의 가드 유지)**: sessionId는 수강생 전원이 공유한다. 여러 학생이
  질문하는 세션에서 켜면 학생 간 대화가 한 스레드로 섞인다 — 기능 오류이자 프라이버시 사고.
  운영 세션에서 켜지 않는다.
- compose에 정확한 이름으로 매핑하고(`:-false`), 이름 불일치로 조용히 꺼지는 사고를
  `test_deployment_config`가 고정한다.

## 검증

- 스테일 체이닝: 죽은 id → 삭제 + 무체이닝 재시도 + 새 id 저장 / 진짜 장애는 2회 후 표면화 /
  delta 이후엔 재시도 없음 — `tests/test_rag_streaming.py` 3건.
- 폴백: 켜면 세션 키로 활성, 꺼짐(기본)이면 기존 가드 그대로 — 2건.
- Redis delete round-trip — `tests/test_redis_conversation_memory.py`.

## 운영 메모

이미 죽은 id가 박힌 사용자는 배포 즉시 복구된다(다음 질문에서 복구 경로를 탐). 배포 전 응급
처치는 `ai:conversation:*` 키 삭제 또는 TTL 대기.
