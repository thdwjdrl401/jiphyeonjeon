# bge-runtime

`bge-runtime`은 BGE-M3 dense embedding만 제공하는 AI 내부 GPU HTTP 서비스다. PostgreSQL,
Redis, RabbitMQ, MinIO와 Java/Spring credential을 갖지 않으며 입력 text나 embedding 값을 로그에
남기지 않는다. ai-worker가 이 내부 HTTP 경계를 호출하며 서비스 단독 Docker image와 opt-in local
Compose profile을 제공한다.

## 현재 경계

- `BAAI/bge-m3`와 immutable full revision
  `5617a9f61b028005a4858fdac845db406aefb181`을 기본값으로 사용
- `cuda` 또는 `cuda:N`만 허용하고 CUDA가 없으면 CPU fallback 없이 시작 실패
- 요청 순서를 유지한 1024차원 unit-normalized dense vector 반환
- model load와 GPU encode를 thread-level lock으로 직렬화
- HTTP 요청이 취소돼도 OS inference thread 완료 전에는 admission을 반납하지 않으며 다음 CUDA
  encode와 겹치지 않음
- batch당 최대 4개, text당 최대 4,000자, active+queued 요청 최대 8개가 기본값
- 인증 후 JSON parsing 전에 request body를 최대 128 KiB로 제한하며 chunked body도 누적 검사
- request body 수신 시간이 5초를 넘으면 `408`로 종료하고 admission을 반환
- admission 초과 요청은 대기시키지 않고 `429`와 `Retry-After: 1` 반환
- model warmup이 완료된 뒤에만 application lifespan과 readiness가 열림

문자 수 제한은 GPU 보호용 보수적 경계이며 BGE-M3의 tokenizer token 수를 정확히 보장하지는
않는다. 한도를 올리려면 실제 입력 분포와 최대 batch로 별도 CUDA smoke를 먼저 수행해야 한다.

## HTTP API

폴더별 구현 설명은 [`app/`](app/README.md), CUDA smoke는 [`scripts/`](scripts/README.md), 자동 검증은
[`tests/`](tests/README.md)에 있다.

관리 endpoint는 인증 없이 process 상태만 제공한다.

- `GET /healthz`
- `GET /readyz`

Embedding endpoint는 body parsing 전에 Bearer token을 검증한다.

```http
POST /internal/v1/embeddings
Authorization: Bearer <BGE_RUNTIME_INTERNAL_TOKEN>
Content-Type: application/json
```

```json
{
  "model": "BAAI/bge-m3",
  "revision": "5617a9f61b028005a4858fdac845db406aefb181",
  "texts": ["질문 또는 문서 청크"]
}
```

응답은 요청과 같은 순서의 `embeddings`, `dimensions=1024`, `normalized=true`를 포함한다.

- 인증 실패: `401` + `WWW-Authenticate: Bearer`
- request body 수신 timeout: `408`
- model/revision 불일치: `409`
- request body 또는 batch 초과: `413`
- 빈 text, text 길이 초과, schema 오류: `422`
- active+queued 요청 상한 초과: `429` + `Retry-After: 1`

이 API는 `ai-worker`와 향후 `ai-api`가 사용할 Python 서비스 간 내부 경계다. Java/FE가 직접 호출하지 않으며
Java/FE 공유 계약인 `docs/CONTRACT.md` 대상이 아니다.

## EC2 ai-worker 연결

교차 호스트 운영은 [`start_ec2_reverse_tunnel.sh`](scripts/start_ec2_reverse_tunnel.sh)를 사용한다. 실행·검증은
[scripts README](scripts/README.md), 책임과 대안은
[ADR-0029](../../docs/decisions/canola/0029-gpu-bge-ec2-ai-worker-connectivity.md)를 정본으로 삼는다.

## 설정

모든 설정은 `BGE_RUNTIME_` prefix를 사용한다. `BGE_RUNTIME_INTERNAL_TOKEN`은 32자 이상이며
필수다. 주요 기본값은 다음과 같다.

| 환경 변수 | 기본값 |
|---|---|
| `BGE_RUNTIME_HOST` | `127.0.0.1` |
| `BGE_RUNTIME_PORT` | `8020` |
| `BGE_RUNTIME_DEVICE` | `cuda` |
| `BGE_RUNTIME_BATCH_SIZE` | `4` |
| `BGE_RUNTIME_MAX_BATCH_SIZE` | `4` |
| `BGE_RUNTIME_MAX_INFLIGHT_REQUESTS` | `8` |
| `BGE_RUNTIME_MAX_TEXT_CHARS` | `4000` |
| `BGE_RUNTIME_MAX_REQUEST_BODY_BYTES` | `131072` |
| `BGE_RUNTIME_REQUEST_BODY_TIMEOUT_SECONDS` | `5.0` |

## 검증

기본 테스트는 CUDA package와 모델 가중치 없이 fake encoder로 실행된다.

```powershell
uv sync --frozen
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests scripts
```

실제 GPU runtime은 별도 extra다.

```powershell
uv sync --frozen --extra cuda
uv run --frozen --extra cuda python scripts/smoke_cuda.py --offline
```

실제 모델 smoke에서는 full revision, 1024차원·유한값·unit norm·입력 순서와 cold/warm latency,
CUDA peak allocated/reserved를 기록한다. 스크립트는 입력 원문과 vector를 출력하지 않는다.
`--offline`은 pinned revision이 로컬 Hugging Face cache에 없으면 다운로드하지 않고 실패한다.

Docker image는 `Dockerfile`로 빌드한다. GPU container 실행에는 NVIDIA Container Toolkit과 Compose의
GPU 지원이 필요하며, 로컬 격리 스택은 `--profile gpu`일 때만 이 무거운 runtime을 올린다. 전체 실행 순서는
[material ingestion E2E runbook](../../docs/decisions/canola/0021-material-ingestion-e2e-runbook.md)에 둔다.

```bash
docker compose -f docker-compose.material-ingestion.yml --profile gpu up -d bge-runtime
```
BGE와 Nemotron을 6 GB GPU에 동시에 상주시킬 수 있다는 보장은 별도 동시 실행 검증 전에는 하지
않는다.

2026-07-27 RTX 4050 Laptop 6 GB에서 위 offline smoke를 실행한 결과는 2개 입력 모두 1024차원,
finite/unit norm, 반복 출력 최대 차이 0이었다. cold 39.3초, warm 116.8ms, CUDA peak allocated
2175.4 MiB / reserved 2188.0 MiB를 기록했다. 이는 짧은 입력 2개의 BGE 단독 측정값이다.
