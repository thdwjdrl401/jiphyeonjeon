# bge-runtime

## 1. 이 서비스가 하는 일

`bge-runtime`은 GPU에서 BGE-M3 dense embedding만 생성하는 내부 FastAPI 서비스다. 입력 순서를 유지한
1024차원 정규화 vector를 반환하며 Java나 Frontend가 직접 호출하지 않는다.

PostgreSQL, Redis, RabbitMQ, MinIO와 Spring credential은 사용하지 않는다. CUDA를 사용할 수 없으면
CPU로 전환하지 않고 시작에 실패한다.

## 2. 누가 어떻게 호출하는가

| 호출자 | 대상 | 통신 | 용도 |
|---|---|---|---|
| ai-api | `POST /internal/v1/embeddings` | HTTP, Bearer | RAG 질문 embedding |
| ai-worker | `POST /internal/v1/embeddings` | HTTP, Bearer | PPTX chunk embedding |
| ai-worker | `GET /readyz` | HTTP | 자료 consumer의 GPU 준비 확인 |
| 운영 환경 | `GET /healthz`, `GET /readyz` | HTTP | 프로세스·model 준비 확인 |
| GPU host | EC2 `127.0.0.1:18020` | reverse SSH tunnel | EC2의 ai-api·ai-worker에 GPU endpoint 제공 |

기본 및 운영 배포는 GPU `127.0.0.1:8020`을 사용한다. EC2의 `:18020`은 tunnel이 loopback bind를 강제하며 public ingress에
노출하지 않는다. 주소·인증·구현 상태는 [`docs/ai/CONTRACT.md`](../../docs/ai/CONTRACT.md)를 따른다.

## 3. 통신 예시

```http
POST /internal/v1/embeddings HTTP/1.1
Authorization: Bearer <BGE_RUNTIME_INTERNAL_TOKEN>
Content-Type: application/json

{
  "model": "BAAI/bge-m3",
  "revision": "5617a9f61b028005a4858fdac845db406aefb181",
  "texts": ["질문 또는 문서 청크"]
}
```

성공 응답은 같은 `model`과 `revision`, `dimensions=1024`, `normalized=true`, 요청과 같은 순서의
`embeddings`를 반환한다. 한 요청에는 기본 최대 4개 text를 보낼 수 있다.

성공은 `200`이다. 잘못된 `Content-Length`는 `400`, 인증 실패는 `401`, body timeout은 `408`,
model/revision 불일치는 `409`, 크기 초과는 `413`, schema·text 위반은 `422`다. 동시 요청 한도 초과는
`429`와 `Retry-After: 1`을 반환한다. 상세 제한은 [애플리케이션 문서](app/README.md)에서 확인한다.

## 4. 처리 흐름

```text
EC2 host process
  → 127.0.0.1:18020
EC2 production container
  → host.docker.internal:18080/internal/bge
  → host-network nginx → EC2 127.0.0.1:18020
  → reverse SSH tunnel
  → GPU 127.0.0.1:8020
  → Bearer 인증 + body/admission 제한
  → BGE-M3 CUDA encode
  → 1024차원 normalized vectors
```

model은 시작할 때 고정 revision으로 warmup한다. CUDA encode는 thread lock으로 직렬화하며, 취소된 HTTP
요청의 inference thread가 끝나기 전에는 다음 작업과 겹치지 않는다.

## 5. 실행과 설정

```bash
cd ai/bge-runtime
uv sync --frozen --extra cuda
BGE_RUNTIME_INTERNAL_TOKEN=<32자-이상-token> \
uv run --frozen --extra cuda python -m app.main
```

운영에서는 고정 revision model cache를 미리 준비하고 Hugging Face·Transformers offline mode로 실행한다.

| 환경변수 | 기본값/조건 | 용도 |
|---|---|---|
| `BGE_RUNTIME_INTERNAL_TOKEN` | 실행 필수, 32자 이상 | 내부 Bearer 인증 |
| `BGE_RUNTIME_HOST`, `BGE_RUNTIME_PORT` | `127.0.0.1`, `8020` | GPU listen 주소 |
| `BGE_RUNTIME_DEVICE` | `cuda` | `cuda` 또는 `cuda:N` |
| `BGE_RUNTIME_BATCH_SIZE` | `4` | 내부 encoder batch |
| `BGE_RUNTIME_MAX_BATCH_SIZE` | `4` | 요청당 최대 text 수 |
| `BGE_RUNTIME_MAX_INFLIGHT_REQUESTS` | `8` | active+queued 요청 상한 |
| `BGE_RUNTIME_MAX_TEXT_CHARS` | `4000` | text 하나의 문자 수 상한 |
| `BGE_RUNTIME_MAX_REQUEST_BODY_BYTES` | `131072` | 인증 후 body 크기 상한 |
| `BGE_RUNTIME_REQUEST_BODY_TIMEOUT_SECONDS` | `5.0` | body 수신 시간 상한 |

GPU→EC2 tunnel은 runtime이 ready인 뒤 다음 운영 script로 시작한다.

```bash
SSH_KEY=/secure/path/bge-tunnel.pem \
SSH_TARGET=bge-tunnel@ec2.example.internal \
./scripts/start_ec2_reverse_tunnel.sh
```

EC2 host process는 `AI_API_BGE_BASE_URL`과 `AI_WORKER_BGE_RUNTIME_URL`에
`http://127.0.0.1:18020`을 사용한다. 운영 container는
`http://host.docker.internal:18080/internal/bge`를 사용하며 nginx가 같은 tunnel로 전달한다.
root 운영 env의 `BGE_RUNTIME_INTERNAL_TOKEN`은 compose에서 각 client token으로 매핑한다.
`AI_INTERNAL_SECRET`은 Spring↔ai-api 전용이므로 GPU bge-runtime에서는 사용하지 않는다.

## 6. 상태 확인

| endpoint | 의미 |
|---|---|
| `GET /healthz` | HTTP 프로세스가 응답할 수 있음 |
| `GET /readyz` | pinned model load와 CUDA warmup이 완료됨 |

management endpoint에는 인증이 없으므로 loopback 밖에 노출하지 않는다. FastAPI 자동 생성
`/docs`, `/redoc`, `/openapi.json`은 개발 편의 기능이며 내부 서비스 계약이 아니다.

## 7. 관련 문서

- [AI 전체 통신 계약](../../docs/ai/CONTRACT.md)
- [애플리케이션 구조와 HTTP 제한](app/README.md)
- [GPU smoke와 EC2 tunnel](scripts/README.md)
- [GPU host 배포](deploy/README.md)
- [실행 환경 예시](deploy/env/bge-runtime.env.example)
- [EC2↔GPU 연결 결정](../../docs/decisions/canola/0029-gpu-bge-ec2-ai-worker-connectivity.md)
- [EC2 container BGE 연결 결정](../../docs/decisions/jinwoo/0002-ai-worker-ai-api-container-bge-connectivity.md)
- [EC2 AI 운영 compose](../../docker-compose.ai-prod.yml)
- [EC2 AI 운영 환경변수](../../.env.ai-prod.example)
