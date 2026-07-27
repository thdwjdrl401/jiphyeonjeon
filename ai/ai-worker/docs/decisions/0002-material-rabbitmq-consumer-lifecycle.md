# ADR-0002: Spring 큐를 변경하지 않는 단일 PPTX consumer를 사용한다

- 상태: Accepted (AI worker local)
- 일자: 2026-07-27
- 범위: `ai/ai-worker`
- 선행 결정: ADR-0001, 루트 ADR-0036

## 배경

Spring은 default exchange와 routing key `ingestion.embed`로 durable queue에 자료 작업을 발행한다. 현재 Java
선언에는 dead-letter argument가 없다. Python이 같은 main queue를 다른 argument로 다시 선언하면 RabbitMQ가
채널을 닫으므로, 원본 실험 코드의 exchange/retry/DLX topology를 그대로 사용할 수 없다.

또한 성공 callback의 응답이 유실되면 같은 message가 재전달된다. 이때 PPTX와 BGE를 다시 실행하면 GPU의 미세한
비결정성 때문에 기존 embedding fingerprint와 충돌할 수 있다. 종료 중 parsing thread를 무제한으로 늘리는 것도
피해야 한다.

## 결정

1. consumer는 기본 비활성화하고 `AI_WORKER_MATERIAL_INGESTION_ENABLED=true`에서만 시작한다.
2. main queue는 passive lookup하며 선언 속성을 소유하지 않는다. AI는 별도 durable
   `ingestion.embed.dlq`만 선언한다.
3. prefetch 1로 한 worker당 동시 job을 하나로 제한한다. ACK는 처리와 terminal callback이 끝난 뒤 수행한다.
4. 일시 실패는 unacked 상태에서 지수 backoff한 뒤 retry header를 올린 persistent message를 main queue에
   publish-confirm하고 원본을 ACK한다. 영구 실패와 retry 소진은 DLQ publish-confirm 뒤 ACK한다. publish 실패는
   원본을 requeue한다.
5. index use case는 source/GPU 호출 전에 DB를 조회한다. BUILDING version은 activate부터 재개하고 SUCCEEDED
   version은 즉시 반환해 READY callback만 재시도한다.
6. terminal callback만 발신한다. 별도 PROCESSING event는 응답 유실 뒤 READY/FAILED를 역전할 수 있어 사용하지
   않는다.
7. readiness는 RabbitMQ와 PostgreSQL 연결을 함께 반영한다. 종료 시 새 delivery를 끊고 진행 중 작업 하나를
   기본 30초 drain한다.
8. 정보가 부족한 `EMBED_DELETE`는 ACK로 버리지 않고 DLQ에 보존한다. resolver가 준비될 때까지 Spring과 Python
   활성화 스위치는 모두 끈다.

## 결과

- Java queue 선언을 수정하지 않고 AI consumer를 검증할 수 있다.
- publish-confirm 이전 ACK가 없어 retry/DLQ 전환 중 message 유실을 막는다.
- callback 재전달이 다운로드·BGE 재실행으로 이어지지 않는다.
- broker TTL retry queue가 없으므로 backoff 동안 worker slot 하나가 점유된다. 현재 prefetch 1의 빠른 scaffold에는
  허용하며 처리량 확장은 broker topology를 Java/infra 담당자와 함께 확정한 뒤 진행한다.
- delete는 아직 완료 기능이 아니며 DLQ replay 대상이다.

## 검증

- handler가 wire 검증, retryable/non-retryable 분류와 stable terminal callback을 강제한다.
- consumer 단위 테스트가 ACK 순서, retry header, DLQ 선발행, publish 실패 requeue와 readiness를 검증한다.
- PostgreSQL 통합 테스트가 BUILDING resume와 SUCCEEDED short circuit identity를 실제 pgvector schema에서
  검증한다.
- 전체 서비스 테스트에는 skip을 추가하지 않는다.
