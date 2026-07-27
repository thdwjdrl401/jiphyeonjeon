# ADR-0002: attempt-aware caption과 query-only pgvector/BGE context adapter

- 상태: 채택(AI 내부), Spring 시간축 계약은 후보
- 일자: 2026-07-27
- 범위: `ai/ai-api`

## 맥락

원본 MVP의 caption consumer는 `audioEndMs/delta`와 session 단위 sequence를 사용한다. 현재 master의
realtime-agent 계약은 `streamElapsedMs/text`이며 sequence는 `(sessionId, sttSessionId)` attempt마다 1부터
다시 시작한다. 원본 store를 이식하면 agent 재시작 뒤 정상 자막을 충돌로 버리거나 서로 다른 시간축을 한
문맥으로 합치게 된다. 자료 검색은 이미 ai-worker가 만든 ACTIVE pgvector index와 독립 BGE runtime을 사용해야
하지만 ai-api가 이 DB를 수정할 이유는 없다.

## 결정

1. realtime-agent의 현재 fixture shape를 ai-api parser 테스트가 직접 소비한다.
2. session마다 최신 attempt 하나만 질문 context로 보관한다. 새 attempt는 이전 text를 교체하고, 늦은 retired
   attempt는 bounded ID와 `occurredAt` 순서로 fail-closed 거부한다.
3. caption evidence와 citation에 `lessonId` scope 및 `sttSessionId` attempt identity를 보존한다.
4. Redis는 Spring과 다른 `ai-rag-live-v1` consumer group을 사용하고 handler 적용 뒤 ACK한다. poison entry는
   ACK, 일시적 처리 실패는 pending 유지한다.
5. material query는 BGE-M3 pinned revision의 1024차원 unit vector를 사용하고 요청 lesson의 ACTIVE
   version만 vector+FTS RRF 검색한다. repository는 `SET LOCAL ROLE`과 `SELECT`만 실행한다. 기본 role은 기존
   migration의 `ai_app`을 재사용하되, production은 설정으로 별도 read-only role을 주입할 수 있다. 이 MR은
   ai-worker migration이나 DB 권한을 변경하지 않는다.
6. material evidence는 vector similarity 0.25 이상 또는 lexical score 0 초과일 때만 채택한다. 이 값은 MVP
   안전 기본값이며 실제 평가 corpus로 조정할 설정값이다.
7. context component는 factory까지만 제공한다. GMS/auth/request registry와 함께 lifespan에 연결하기 전
   production RAG endpoint는 계속 `503`이다.

## 결과와 후속

- Redis/PostgreSQL 통합 테스트는 기본 compose에서 skip 없이 실행한다. PostgreSQL은 무작위 `*_test` DB와
  role만 생성·삭제하고 Java의 shared application DB는 건드리지 않는다.
- `contextTimeMs`는 최신 attempt의 `streamElapsedMs` 좌표여야 한다. Spring/HLS session clock 변환은 Java
  채택 common MR의 필수 gate다.
- multi-replica context 공유, abandoned PEL claim, Redis retention과 retrieval 품질 평가는 후속 hardening이다.
