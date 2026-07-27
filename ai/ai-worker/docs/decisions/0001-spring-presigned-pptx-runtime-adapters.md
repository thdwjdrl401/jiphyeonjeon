# ADR-0001: Spring 주문형 URL과 분리된 BGE runtime adapter를 사용한다

- 상태: Accepted (AI worker local)
- 일자: 2026-07-27
- 범위: `ai/ai-worker`
- 공유 계약 근거: `feat/be/ai-material-download-url` revision `6f47207`, 루트 CONTRACT §3-1/§3-2,
  ADR-0036

## 배경

기존 실험 구현은 worker가 MinIO endpoint와 장기 access/secret key를 소유하고 bucket/object key로 PPTX를 직접
읽었다. 새 Spring 계약은 RabbitMQ envelope에 `assetId`만 싣고, worker가 처리 직전에 HMAC으로 주문형
presigned GET URL을 발급받도록 결정했다. 이 방식은 worker의 storage 자격증명과 object key 규칙 의존을
제거하지만, 서명 raw body 일치, 단명 URL 비저장, download byte 제한과 오류 재시도 분류를 adapter가 보장해야
한다.

동시에 BGE-M3는 별도 내부 HTTP/CUDA runtime으로 이미 분리되어 있다. Spring HMAC secret과 BGE Bearer token은
서로 다른 trust boundary다. RabbitMQ consumer 계약은 ACK/retry/DLQ와 completed-job short circuit 결정이 더
필요하므로 외부 resource adapter와 같은 변경에 실행 루프까지 넣지 않는다.

## 결정

1. Spring `PPTX_EMBED`·`EMBED_DELETE` version 1 envelope를 별도 Pydantic wire model로 검증한다. camelCase만
   허용하고 unknown field, unknown model alias와 contract version을 fail-closed로 거부한다.
2. embed job은 `tenant=liveclass`, `material_version=1`, Spring outbox와 같은
   `material:{materialId}:embed` idempotency key로 결정적으로 내부 model에 변환한다. 재색인 version이 필요하면
   이 내부 가정을 확장하지 않고 공유 계약을 먼저 바꾼다.
3. worker는 MinIO SDK와 자격증명을 사용하지 않는다. `assetId` JSON bytes를 Spring shared secret으로
   `base64(HMAC-SHA256(secret, rawBody))` 서명하고 그 bytes를 그대로 URL 발급 endpoint에 보낸다.
4. presigned URL은 HTTP(S), no-userinfo, no-fragment를 검증하고 저장·로그·재사용하지 않는다. redirect를 자동
   추적하지 않고 즉시 GET하며 Content-Length와 실제 streaming bytes 모두에 50 MiB 상한을 적용한다.
5. Spring URL 발급의 401은 non-retryable 설정 오류, 404는 업로드 지연을 포함할 수 있어 retryable로 분류한다.
   presigned GET 401/403은 새 URL 재발급이 필요하므로 retryable로 분류한다. adapter 내부 재시도는 하지 않는다.
6. BGE adapter는 별도 Bearer token, 고정 40자리 revision, 최대 batch 4와 순차 ordering을 사용한다. 응답
   identity·차원·정규화·개수·finite non-zero vector를 검증한다.
7. Spring callback은 source 발급과 같은 signer를 재사용한다. callback event ID는 worker job ID와 event type의
   UUIDv5로 만들 수 있어 같은 사건의 HTTP 재시도에서 안정적이다. 204만 성공으로 인정한다.
8. wiring builder는 Spring/BGE HTTP client와 pgvector engine을 소유하고 모두 닫는다. `app.main`과 RabbitMQ
   consumer에는 연결하지 않아 이 변경만 배포해도 job을 소비하지 않는다.
9. 기존 `source_bucket/source_object_key` DB column은 이번 adapter MR에서 파괴적으로 변경하지 않는다.
   `spring-asset`과 asset UUID를 compatibility locator로 저장하고 실제 bucket/key로 해석하지 않는다.

## 결과

- worker에서 MinIO 장기 자격증명과 storage 경로 지식이 제거된다.
- URL 발급과 callback이 Java verifier와 같은 raw-body HMAC 규칙을 사용한다.
- source, embedding, callback과 DB resource를 consumer 구현 전에 독립적으로 계약 테스트할 수 있다.
- material UUID당 version 1 가정은 현재 attachment-once 계약에는 맞지만 동일 material 재색인은 지원하지 않는다.
- delete envelope의 정보만으로는 기존 scope/version tombstone 계약을 충족하지 못한다.
- callback 실패 재전달에서 재임베딩을 피할 completed-job 조회와 ACK/retry/DLQ는 후속 consumer 책임이다.

## 검토한 대안

- MinIO direct adapter 유지: 새 최소권한 계약과 storage decoupling을 위반해 제외했다.
- presigned URL을 RabbitMQ body에 저장: queue 지연과 retry 때 TTL이 만료되므로 제외했다.
- download adapter에서 자동 재발급·재시도: consumer retry budget과 중복되어 폭주·종료 제어가 어려워 제외했다.
- 이번 변경에서 RabbitMQ consumer까지 연결: delete scope, broker DLQ와 completed-job short circuit이 미정이라
  실행 gate를 분리했다.
- 기존 DB source column 즉시 rename: pipeline이 아직 꺼져 있어 급하지 않고 downgrade/data migration 검토가
  필요한 저장 변경이므로 별도 MR로 미뤘다.

## 검증

- BE 문서의 embed/delete JSON fixture를 camelCase, version, UUID와 model alias까지 검증한다.
- URL 발급 요청의 exact raw body와 독립 계산한 HMAC signature가 일치하는지 검증한다.
- source 발급/GET status, URL schema, MIME, Content-Length, streaming limit과 secret/URL 비노출을 검증한다.
- BGE batching·ordering·인증·response identity와 오류 분류를 MockTransport 계약 테스트로 검증한다.
- callback raw body·signature·stable event ID·204/status 분류를 검증한다.
- wiring이 같은 Spring client/signer를 source와 callback에 공유하고 모든 owned resource를 한 번만 닫는지
  검증한다.
