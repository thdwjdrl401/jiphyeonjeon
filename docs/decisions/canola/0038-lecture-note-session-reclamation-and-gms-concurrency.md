# ADR-0038: 강의 노트 완료 상태를 회수하고 GMS 호출을 전역 제한한다

- 상태: 승인
- 일자: 2026-08-03
- 적용 범위: `ai-api/app/lecture_notes`

## 맥락

ai-api는 동시에 진행되는 라이브마다 `LectureNoteService._sessions`에 전체 구조화 노트, pending/in-flight,
outbox와 task 상태를 보관하고 같은 내용을 Redis checkpoint
`ai:lecture-notes:mvp:state:{sessionId}`에 저장한다. refined snapshot 발행과 caption completion ACK가 모두
끝나면 Redis checkpoint는 삭제했지만 Python의 `_sessions` entry와 accumulator buffer는 남겼다. 장시간
운영하면 종료된 강의 수만큼 전체 노트가 프로세스 메모리에 누적된다.

단순히 두 메모리 entry를 모두 삭제하면 늦게 도착한 caption이 같은 `sessionId`의 신규 상태를 만들어 이미
종료된 강의를 다시 활성화할 수 있다. full state 회수와 terminal fencing을 함께 해결해야 한다.

현재 세션별 drain task는 같은 세션의 GMS 호출만 직렬화한다. 서로 다른 세션은 제한 없이 동시에 GMS를
호출하므로 여러 라이브의 window flush가 겹치면 provider rate limit, 비용 spike와 timeout 연쇄가 발생할 수
있다. ai-api는 현재 단일 replica이므로 먼저 process-local 경계를 두고, replica 확장 시 분산 경계로
승격할 수 있어야 한다.

## 결정

### 1. 완료 세션 메모리 회수

refined snapshot 발행 여부가 확정되고 caption completion ACK까지 끝난 시점에 다음 순서로 정리한다.

1. Redis active set에서 세션을 제거하고 checkpoint key를 삭제한다.
2. `LectureNoteService._sessions`에서 전체 `LectureNote`와 작업 상태를 제거한다.
3. accumulator의 partial text·context·attempt 상태를 제거한다.
4. 같은 `sessionId`의 늦은 event를 거절할 수 있는 ID-only 완료 tombstone만 남긴다.

tombstone은 accumulator의 `max_sessions`와 같은 상한을 가진 LRU로 제한한다. tombstone에 전체 노트,
자막, lesson 정보를 저장하지 않는다. active session을 실수로 제거하려는 호출은 실패시켜 진행 중 데이터
유실을 막는다. late delta와 duplicate completion은 기존 metric에 반영하고 downstream event를 만들지 않는다.

### 2. GMS 동시성 제한의 단계적 도입

즉시 적용할 목표 구조는 process-local bounded scheduler다.

- 전체 in-flight GMS 호출 기본값은 `4`로 시작하고 환경 변수로 조정한다.
- 종료 후 refinement in-flight는 전체 4개 중 최대 `1`개로 제한해 live append 지연을 보호한다.
- 같은 세션은 지금처럼 한 번에 한 호출만 수행하고 pending window는 하나로 합친다.
- live append를 refinement보다 우선하되 refinement가 영구 대기하지 않도록 연속 live 처리 횟수에 상한을 둔다.
- 대기 작업은 세션별 durable checkpoint에 남기고 메모리에는 세션당 하나의 pending batch만 둔다.
- queue wait, in-flight, pending session 수, 429/5xx, timeout, p50/p95 latency와 호출 비용을 metric으로 남긴다.

`asyncio.Semaphore` 하나는 전체 in-flight 상한을 빠르게 만들 수 있지만 우선순위와 starvation을 표현하지
못한다. 따라서 첫 구현도 `PriorityQueue + 고정 worker`를 사용한다. live 작업을 높은 우선순위로 두고
refinement worker 상한 1을 함께 적용한다. 초기 동시성 `4`는 provider quota가 아니라 안전한 시작값이며,
실제 dev 부하에서 429 비율, queue wait p95와 latency를 보고 조정한다.

429와 일시적 5xx는 `Retry-After`를 우선하고 지수 backoff + jitter로 최대 3회 재시도한다. 인증 오류,
payload validation 오류와 prompt 상한 위반은 재시도하지 않는다. 재시도 후에도 실패한 작업은 현재
checkpoint를 유지해 재시작 복구가 가능하게 하되, 무한 재시작 재시도를 막는 최종 실패 상태는 별도 계약으로
추가한다.

### 3. 선택하지 않은 대안

- **무제한 세션별 task**: 가장 단순하지만 동시 라이브 수가 곧 외부 API 동시성이므로 유지하지 않는다.
- **Semaphore만 사용**: 단기 hotfix는 가능하지만 live/refinement 우선순위와 starvation을 해결하지 못한다.
- **RabbitMQ로 live 노트 호출 이동**: durable하지만 라이브 지연과 세션 순서 제어 비용이 커 현재 경로에는
  사용하지 않는다.
- **Redis 분산 limiter를 즉시 도입**: 현재 단일 replica에서는 복잡도만 늘어난다. ai-api를 여러 replica로
  확장할 때 session owner와 함께 도입한다.

## 다중 replica 전환 조건

ai-api가 둘 이상이면 process-local queue만으로 전체 GMS 한도를 보장할 수 없다. 그때는 세션별 단일 owner를
먼저 정하고 Redis token bucket 또는 단일 scheduler service로 전체 RPM/TPM/in-flight 한도를 공유한다.
분산 limiter 없이 replica 수만 늘리는 것은 허용하지 않는다.

## 검증

- 완료 후 service `tracked_sessions=0`, accumulator full state `0`, tombstone `1`을 확인한다.
- 완료 후 늦은 delta와 중복 completion이 모델 호출·append·snapshot을 만들지 않는지 검증한다.
- 진행 중 세션을 제거하는 호출이 실패하는지 검증한다.
- GMS scheduler 구현 시 1/4/12 세션 burst에서 in-flight 상한, live 우선순위, refinement 비기아,
  queue wait와 429 retry를 deterministic fake model로 검증한다.

## 결과

완료된 강의의 큰 Python 상태는 즉시 회수하면서 늦은 event의 세션 부활은 막는다. GMS 호출량은 동시 라이브
수와 분리된 명시적 자원 경계를 갖게 되며, 단일 replica에서 검증한 뒤 분산 limiter로 확장할 수 있다.

## 참고

- [축적형 강의 노트 MVP](0034-near-realtime-accumulative-lecture-notes.md)
- [강의 노트 Redis 계약](../../CONTRACT.md#3-4a-ai-api--application-redis-실시간-강의-노트-stream--ai-producer-구현-spring-consumer-미구현)
