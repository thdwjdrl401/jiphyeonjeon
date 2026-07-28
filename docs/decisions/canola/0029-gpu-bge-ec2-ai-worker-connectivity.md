# ADR-0029: GPU BGE와 EC2 ai-worker는 loopback reverse SSH tunnel 위 HTTP로 연결

- **상태**: 채택
- **일자**: 2026-07-28
- **관련**: [ADR-0013](0013-bge-m3-runtime-boundary.md),
  [ADR-0018](0018-spring-presigned-pptx-runtime-adapters.md),
  [ADR-0019](0019-material-rabbitmq-consumer-lifecycle.md),
  [ADR-0024](0024-realtime-agent-gpu-turn-runtime.md)

## 맥락

운영 목표 topology는 EC2의 `ai-worker`가 자료 job·PPTX parsing·chunking·pgvector 저장·Spring callback을 소유하고, GPU 서버의 `bge-runtime`이 BGE-M3 추론만 소유하는 구조다. Python HTTP client와 `/internal/v1/embeddings` 계약은 이미 구현됐지만 두 호스트 사이의 안전한 network path가 없었다.

GPU 서버는 inbound port를 안정적으로 공개할 수 있다는 전제가 없고, BGE endpoint에는 강의자료 원문 chunk와 embedding vector가 흐른다. 공개 HTTP port를 열거나 JSON vector를 RabbitMQ request/reply로 돌리면 TLS·방화벽·응답 상관관계·timeout·중복 결과 계약이 추가된다.

## 결정

### 책임과 데이터 흐름

```text
Spring outbox -> EC2 RabbitMQ -> EC2 ai-worker
                                  | 1. Spring presigned URL로 PPTX 획득
                                  | 2. parse + deterministic chunk
                                  v
EC2 127.0.0.1:18020 == reverse SSH tunnel ==> GPU 127.0.0.1:8020 bge-runtime
                                  ^                 | BGE-M3 encode
                                  |<-- HTTP 200 vectors ------------|
                                  | 3. ai-worker가 ai schema pgvector 저장
                                  + 4. Spring READY/FAILED callback
```

Spring은 embedding vector를 직접 받지 않는다. RabbitMQ는 durable material job 전달에만 쓰고, chunk와 vector는 기존 Python↔Python HTTP 요청/응답으로 교환한다. `bge-runtime`은 RabbitMQ·PostgreSQL·Spring credential을 갖지 않는다.

### network path

1. GPU 서버에서 BGE를 `127.0.0.1:8020`에 bind한다.
2. GPU 서버가 전용 SSH key로 EC2에 outbound 연결하고 `-R 127.0.0.1:18020:127.0.0.1:8020`을 유지한다.
   EC2 sshd는 tunnel 전용 계정에 `GatewayPorts no`, `AllowTcpForwarding remote`, `PermitListen 127.0.0.1:18020`을 적용한다.
3. EC2 host process인 ai-worker는 `AI_WORKER_BGE_RUNTIME_URL=http://127.0.0.1:18020`을 사용한다.
4. tunnel listener는 EC2 loopback에만 둔다. GPU/EC2 security group에 BGE port를 공개하지 않는다.
5. tunnel은 foreground process로 실행하고 systemd의 `Restart=always` 또는 동등한 supervisor가 재시작한다.

초기 운영은 ai-worker를 EC2 host process로 둔다. Docker container의 `127.0.0.1`은 host tunnel이 아니므로 container 배포는 host network 또는 전용 tunnel sidecar/network를 별도 결정하기 전까지 이 endpoint를 그대로 사용하지 않는다.

### 인증과 실패

- SSH가 transport 암호화와 host identity를 제공한다. `-F /dev/null`, `StrictHostKeyChecking=yes`, `BatchMode=yes`, `ExitOnForwardFailure=yes`, keepalive를 사용한다.
- BGE application 인증은 기존 Bearer token을 유지한다. GPU의 `BGE_RUNTIME_INTERNAL_TOKEN`과 EC2의 `AI_WORKER_BGE_INTERNAL_TOKEN`만 같게 주입하고 Spring HMAC secret과 공유하지 않는다.
- script는 local `/readyz`가 성공한 뒤에만 tunnel을 시작한다. EC2에서는 ai-worker 시작 전에 `http://127.0.0.1:18020/readyz`를 확인한다.
- tunnel 단절·timeout은 기존 `RemoteEmbeddingError(retryable=true)`로 분류한다. consumer의 bounded retry와 DLQ를 사용하며 별도 HTTP 무한 retry를 추가하지 않는다.
- BGE 호출은 같은 입력에 대한 pure inference이므로 transport retry가 별도 side effect를 만들지 않는다. ai-worker의 기존 DB completion short-circuit가 완료 job의 재추론을 막는다.

## 대안

| 대안 | 판단 |
|---|---|
| GPU BGE port를 public HTTPS로 노출 | 인증서·ingress·방화벽 운영과 원문 노출면이 늘어 기각 |
| RabbitMQ request/reply로 chunk·vector 교환 | correlation·reply queue·대용량 JSON·중복 응답 계약이 추가돼 기각 |
| bge-runtime이 pgvector에 직접 쓰기 | stateless GPU compute 경계와 최소권한을 깨므로 기각 |
| ai-worker 전체를 GPU 서버로 이동 | 단순하지만 RabbitMQ·DB·Spring·MinIO 연결과 credential 범위가 GPU 노드로 확대돼 보류 |
| WireGuard/Tailscale/VPC private network | 장기 운영 대안. 도입 시 `AI_WORKER_BGE_RUNTIME_URL`만 바꾸고 HTTP 계약은 유지 |

## 구현과 완료 조건

- `ai/bge-runtime/scripts/start_ec2_reverse_tunnel.sh`가 명시적 key/target, local readiness, loopback-only reverse bind와 foreground SSH를 제공한다.
- script argument와 fail-closed 동작을 기본 테스트에서 검증한다.
- `ai/ai-worker/scripts/smoke_remote_bge.py`가 EC2에서 실제 Bearer 인증 embedding 왕복과 1024차원 정규화
  vector를 검증하되 token·입력·vector를 출력하지 않는다.
- ai-worker readiness에 PostgreSQL뿐 아니라 tunnel을 통한 BGE `/readyz`를 포함한다.
- 실제 완료는 GPU BGE warmup, reverse tunnel, EC2 ai-worker를 함께 띄워 한 PPTX가 1024차원 vector로 저장되고 Spring `READY` callback까지 도달한 E2E로 증명한다.
- 이 결정은 Java/FE wire payload를 바꾸지 않는다. 다만 EC2 ai-worker와 GPU bge-runtime을 서로 다른
  배포 주체가 운영할 때 함께 지켜야 할 HTTP 경계이므로 공유 정본
  [`docs/CONTRACT.md` §3-7](../../CONTRACT.md#3-7-ec2-ai-worker--gpu-bge-runtime-http--ai-구현됨)에
  요청·응답·인증·실패 분류를 기록한다.
