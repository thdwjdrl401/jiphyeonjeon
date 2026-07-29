# ADR-0002: ai-worker/ai-api 컨테이너 배포는 기존 gpu-proxy를 경유해 BGE에 연결

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-07-29
- **관련**: [ADR-0029](../canola/0029-gpu-bge-ec2-ai-worker-connectivity.md),
  커밋 `e012eaa`(`chore/infra/gpu-tunnel-proxy`, 송정기)

## 맥락 (Context)

ADR-0029는 EC2 ai-worker를 초기에는 host process로 두고, Docker container 배포는
"host network 또는 전용 tunnel sidecar를 별도 결정하기 전까지" 보류한다고 명시했다.
`ai-worker`/`ai-api`를 `docker-compose.ai-prod.yml`로 EC2에 컨테이너 배포하려면 이 결정이 필요했다.

같은 시점에 송정기가 `chore/infra/gpu-tunnel-proxy`(커밋 `e012eaa`)로 `docker-compose.gpu-proxy.yml` +
`infra/nginx/gpu-proxy.conf`를 만들어, host 네트워크 nginx가 EC2 host의 `127.0.0.1:18020`
(GPU reverse tunnel)을 `18080/internal/bge/`로 내보내고 `172.18.0.0/16`(liveclass_default)·localhost만
허용하도록 이미 구현·머지했다. ADR-0029가 말한 "전용 tunnel sidecar"에 해당하는 결정이 이미 나 있었다.

`AI_WORKER_BGE_RUNTIME_URL`/`AI_API_BGE_BASE_URL` 설정 검증(Pydantic)이 경로 있는 URL을 거부하고
있어서, 이 프록시의 `/internal/bge` 경로를 그대로 base URL로 넣을 수 없었다.

## 결정 (Decision)

`ai-worker`/`ai-api` 컨테이너는 자체 sidecar를 새로 만들지 않고 기존 `docker-compose.gpu-proxy.yml`을
그대로 재사용한다. `AI_WORKER_BGE_RUNTIME_URL`/`AI_API_BGE_BASE_URL`을
`http://host.docker.internal:18080/internal/bge`로 설정하고, `extra_hosts: ["host.docker.internal:host-gateway"]`로
컨테이너에서 EC2 host로 나갈 수 있게 한다. 두 설정값의 URL 검증에서 경로 금지 제약을 제거하되
디렉터리 순회(`..`)는 계속 차단한다(`spring_internal_base_url`은 경로 금지 그대로 유지).

## 근거 (Rationale)

- 이미 채택·검증된 인프라(`e012eaa`)를 재사용하는 게 새 sidecar나 EC2 sshd `GatewayPorts` 설정
  변경보다 변경 범위가 작고 안전하다.
- `httpx`(0.28.1) 실측 확인: `base_url`에 경로가 있어도 `.post("/internal/v1/embeddings")`(절대 경로,
  현재 코드 그대로) 호출 시 base 경로가 사라지지 않고 그대로 유지된 채 합쳐진다. 즉 요청 로직
  코드는 변경할 필요가 없었고, 설정값 검증만 완화하면 됐다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| (선택) 기존 gpu-proxy(`e012eaa`) 경유, 검증만 완화 | 새 인프라 불필요, 변경 범위 최소 | ai-worker/ai-api가 gpu-proxy 존재를 전제로 함(문서로 명시) |
| 자체 nginx sidecar를 `docker-compose.ai-prod.yml`에 추가 | 이 파일만으로 자기완결 | 이미 있는 것과 중복, 유지보수 포인트 두 배 |
| ai-worker/ai-api를 `network_mode: host`로 전환 | 경로 문제 자체가 없어짐 | postgres/redis/rabbitmq/backend도 전부 루프백 게시로 바꿔야 해서 `docker-compose.prod.yml`(송정기 소유) 변경 범위가 오히려 커짐 |
| EC2 sshd `GatewayPorts clientspecified`로 터널 자체를 브리지 게이트웨이 IP에 bind | sidecar 불필요 | SSH 터널(보안 민감 설정) 자체를 건드림, `e012eaa`가 이미 더 안전한 방식으로 같은 문제를 풀어놔서 불필요 |

## 영향·후속 (Consequences)

- `ai/ai-worker/app/config.py`, `ai/ai-api/app/config.py`의 URL 검증 완화, 테스트 추가.
- `docker-compose.ai-prod.yml`이 `host.docker.internal:18080/internal/bge`를 가리키도록 반영.
- `ai/ai-worker/README.md`, `ai/ai-api/README.md`에 컨테이너 배포 시 연결 방식 추가.
- 후속: 실제 EC2에 `docker-compose.ai-prod.yml`을 띄워 gpu-proxy 경유 embedding 왕복을 실제로
  검증해야 한다(현재까지는 설정·코드 레벨 검증만 완료).
