# ADR-0016: PPTX ingestion core를 transport와 분리한다

- 상태: Accepted (AI-only scope)
- 일자: 2026-07-27
- 범위: `ai/ai-worker`

## 배경

원본 AI 실험 브랜치에는 PPTX 파싱, RabbitMQ payload, MinIO, remote embedding, callback과 삭제 흐름이 한 번에
섞여 있다. 이 상태로 가져오면 아직 Java와 합의하지 않은 wire field와 asset 소유권까지 Python이 먼저 확정하게
된다. 또한 OOXML parser는 공격적인 ZIP 입력과 CPU·memory 사용량을 제한해야 하고, 부분 index가 현재 ACTIVE
version을 대체하지 않도록 저장 경계와 연결되어야 한다.

## 결정

1. 이번 변경은 PPTX bytes를 입력받는 transport-neutral Python use case만 도입한다. RabbitMQ message, HTTP
   callback과 Java DTO를 이 내부 모델에서 파생하거나 확정하지 않는다.
2. PPTX ZIP은 디스크에 풀지 않고 메모리에서 검증한다. unsafe/colliding path, symlink, 암호화 entry, 잘못된 OPC
   package와 source·entry·전체 압축 해제량·compression ratio·slide·shape·block·text·relationship limit
   위반을 거부한다.
3. 텍스트 shape, table과 발표자 노트를 slide 순서로 추출한다. 외부 relationship은 조회하지 않으며 notes가 없는
   slide를 위해 filesystem template를 열지 않는다.
4. chunk는 slide 경계를 넘지 않고 NFC·공백 정규화, 고정 ordering, versioned 최대 길이 strategy와 page를 포함한
   SHA-256 content hash를 사용한다.
5. embedding adapter의 model 이름, pinned revision, 응답 개수와 1024차원 finite non-zero vector를 검증한
   뒤에만 저장한다. 입력 순서 보존은 positional port 계약으로 고정한다.
6. 완성된 chunk 전체를 먼저 stage하고, 성공한 경우에만 동일한 material identity로 activate한다. parse, chunk,
   embedding 또는 stage 실패에서는 activate하지 않는다.
7. 동기식 parse와 chunk는 `asyncio.to_thread`로 event loop 밖에서 실행한다. 이미 시작한 thread는 coroutine
   취소로 중단되지 않으므로 bounded executor 또는 process isolation, 동시성 제한과 shutdown drain은 runtime
   adapter의 후속 책임으로 둔다.
8. `curriculum_id`를 포함한 내부 snake_case 모델은 wire DTO가 아니다. `curriculumId`는 Java와 함께 공유 계약과
   양측 계약 테스트를 채택하기 전까지 후보로만 남긴다.

## 결과

- parser, chunker와 저장 use case를 RabbitMQ, MinIO 또는 Java 없이 빠르게 단위 테스트할 수 있다.
- 비정상 PPTX가 파일 시스템, 네트워크 또는 무제한 압축 해제를 통해 worker를 침범하는 경로를 줄인다.
- deterministic chunk identity와 stage-then-activate 순서로 부분 index 노출을 막는다.
- 현재 worker는 ingestion job을 실제 consume하지 않으며 배포만으로 PPTX 처리가 시작되지 않는다.
- `asyncio.to_thread`는 event loop blocking을 피하지만 강제 취소·격리를 제공하지 않는다.

## 후속 결정

- Java와 함께 source version, idempotency key, delete scope, source acquisition 및 `curriculumId` wire field를
  확정한다.
- immutable/versioned asset 소유권을 합의한 뒤 index 삭제와 원본 객체 삭제를 별도 use case로 설계한다.
- MinIO stat, MIME/content-type, download 전 크기 guard와 timeout을 adapter 계약으로 추가한다.
- remote BGE의 최대 batch 크기 4, 입력-출력 순서, 인증, timeout과 retry를 고정한다.
- RabbitMQ ACK 시점, retry/backoff, DLQ, callback/outbox와 completed-job result 재사용을 결정한다.
- embedding을 포함하는 storage fingerprint와 GPU 비결정성 충돌을 피하도록 completed-job short circuit 또는
  durable result/outbox를 마련한다.
- 이미지 OCR, SmartArt, chart와 grouped shape 텍스트는 별도 지원 범위와 resource limit을 정의한다.
- 실제 MinIO, RabbitMQ, remote BGE를 잇는 E2E와 재전달·부분 실패 시나리오는 adapter 도입 MR에서 실행한다.

## 검토한 대안

- 원본 브랜치의 runtime stack 전체 cherry-pick: Java 미합의 계약과 transport 구현이 함께 유입되어 제외했다.
- RabbitMQ payload를 먼저 Python에서 확정: 양측 채택과 계약 테스트 없이 공유 계약을 만들게 되어 제외했다.
- ZIP을 임시 디렉터리에 extract: path traversal·symlink와 정리 실패 표면이 커져 제외했다.
- parse와 저장을 한 transaction에서 처리: 긴 CPU/embedding 작업 동안 DB transaction을 유지하게 되어
  stage-then-activate 경계를 유지했다.
- coroutine 취소만으로 parse 중단 보장: `asyncio.to_thread`의 실행 모델상 보장되지 않아 runtime 격리를 후속
  결정으로 남겼다.

## 검증

- in-memory fixture로 text/table/notes 순서, notes 없는 deck, malformed OPC와 외부 relationship 비조회 여부를
  검증한다.
- unsafe/colliding ZIP path, symlink, 암호화 entry와 각 resource limit을 parser test로 검증한다.
- chunk 정규화, slide 경계, hard split, ordering, hash와 strategy version을 회귀 테스트로 고정한다.
- embedding identity·개수·차원·finite 조건과 실패 시 미저장·미활성화를 use case test로 검증한다.
- 실제 MinIO, RabbitMQ와 remote BGE E2E는 이 ADR의 범위가 아니며 실행하지 않는다.
