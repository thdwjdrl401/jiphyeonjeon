# AI services

## 1. 어떤 서비스가 있는가

LiveClass AI는 Python 3.12와 `uv`를 사용하며 서비스별 의존성과 lockfile을 독립 관리한다.

| 서비스 | 실행 위치 | 역할 | 업무 입력 |
|---|---|---|---|
| [ai-api](ai-api/README.md) | EC2 `:8010` | RAG 검색·답변 SSE | Spring HTTP |
| [ai-worker](ai-worker/README.md) | EC2, 관리 `:8011` | PPTX embedding·인덱싱 | RabbitMQ |
| [realtime-agent](realtime-agent/README.md) | GPU, 관리 `:8081` | LiveKit audio→STT→Redis 자막 | LiveKit dispatch |
| [bge-runtime](bge-runtime/README.md) | GPU `:8020` | BGE-M3 embedding | 내부 HTTP |

Frontend는 AI 서비스를 직접 호출하지 않는다. 사용자 인증·권한과 공개 API는 Spring이 소유하고,
강사의 microphone만 LiveKit으로 직접 전송한다.

## 2. 누가 어떻게 호출하는가

| 호출자 | 대상 | 통신 | 입력 | 출력 |
|---|---|---|---|---|
| Spring | ai-api | HTTP + SSE, HMAC | RAG 질문 | answer event |
| Spring | ai-worker | RabbitMQ `ingestion.embed` | 자료 작업 | Spring callback |
| ai-worker | Spring | HTTP, HMAC | download-url 요청·처리 결과 | presigned URL·204 |
| Spring | realtime-agent | LiveKit explicit AgentDispatch | session metadata | Redis 자막 |
| Frontend | LiveKit room | WebRTC | 강사 microphone | agent가 Redis에 자막 발행 |
| ai-api·ai-worker | bge-runtime | HTTP, Bearer | text 목록 | 1024차원 vector |
| realtime-agent | application Redis | Redis Stream | caption event | ai-api·향후 Spring 소비 |
| 운영 환경 | 각 서비스 관리 endpoint | HTTP | health/readiness | 상태 응답 |

endpoint, queue, Redis key, payload, 인증과 상태코드의 기준은
[AI 통신 계약 지도](../docs/ai/CONTRACT.md)다. README에는 계약을 복제하지 않고 대표 사용법만 둔다.

## 3. 대표 통신 흐름

RAG 질문:

```text
Redis caption Stream → ai-api background consumer → in-memory caption store
Spring → ai-api → bge-runtime 질문 embedding → PostgreSQL 자료 검색
              → in-memory 최근 자막 조회 → GMS → SSE → Spring
```

자료 처리:

```text
Spring → RabbitMQ → ai-worker → Spring download-url → PPTX GET
                              → bge-runtime → PostgreSQL
                              → Spring READY/FAILED callback
```

실시간 자막:

```text
Frontend microphone → LiveKit
Spring dispatch ─────→ LiveKit → realtime-agent → Nemotron/OpenAI
                                           └────→ Redis caption stream
```

## 4. EC2와 GPU 배치

```text
EC2 container                 EC2 host                         GPU
ai-api / ai-worker ──HTTP──→ :18080/internal/bge ──nginx──→ :18020 ⇠SSH-R⇢ bge-runtime :8020
Spring ──dispatch────────────→ LiveKit ⇠SSH-L(control)────── realtime-agent
application Redis ⇠────────── SSH-L(control) ─────────────── realtime-agent
TURN/TCP ⇠─────────────────── SSH-L(TURN) ────────────────── realtime-agent
:18081 ⇠───────────────────── SSH-R(control) ─────────────── realtime-agent :8081
```

GPU application port는 public ingress로 열지 않는다. BGE와 realtime-agent 관리 경계는 EC2 loopback의
`:18020`, `:18081`로 reverse-forward한다. EC2 host process는 BGE `:18020`을 직접 사용하고, 운영
container는 host-network nginx의 `:18080/internal/bge`를 경유한다.

## 5. 실행과 설정

서비스별 디렉터리에서 `uv sync --frozen` 후 해당 entrypoint를 실행한다. CUDA 서비스는 별도 extra와
GPU model 준비가 필요하다.

| 서비스 | 실행 entrypoint |
|---|---|
| ai-api | `python -m app.main` |
| ai-worker | `python -m app.main` |
| realtime-agent | `python -m app.main start` |
| bge-runtime | `python -m app.main` |

ai-api·realtime-agent 로컬 설정은 [`ai/.env.example`](.env.example)을 `ai/.env`로 복사한다. EC2
ai-api·ai-worker 운영 설정은 [`.env.ai-prod.example`](../.env.ai-prod.example)과
[`docker-compose.ai-prod.yml`](../docker-compose.ai-prod.yml)을 따른다.

| 값 | 사용하는 경계 | GPU 사용 |
|---|---|---|
| `AI_INTERNAL_SECRET` | Spring→ai-api RAG HMAC | 사용하지 않음 |
| `AI_CALLBACK_SECRET` | Spring↔ai-worker 자료 HMAC | realtime callback을 켤 때만 별도 선택 사용 |
| `BGE_RUNTIME_INTERNAL_TOKEN` | EC2 ai-api·ai-worker→GPU bge-runtime Bearer | bge-runtime이 사용 |
| `GMS_API_KEY` | EC2 ai-api→GMS 답변 모델 | 사용하지 않음 |

운영 compose는 `BGE_RUNTIME_INTERNAL_TOKEN`을 container의 `AI_API_BGE_TOKEN`과
`AI_WORKER_BGE_INTERNAL_TOKEN`으로, `GMS_API_KEY`를 `AI_API_GMS_API_KEY`로 매핑한다. 필수
환경변수와 tunnel 실행은 각 서비스 README를, 전체 인프라와 Spring·Frontend 실행 순서는
[RUN.md](../RUN.md)에서 확인한다.

## 6. 현재 연동 상태

| 경계 | 현재 상태 |
|---|---|
| Spring→ai-api RAG SSE | AI 구현, Spring signer·proxy 미구현 |
| Spring→RabbitMQ→ai-worker | `PPTX_EMBED` 양쪽 구현, Spring producer·worker 앱 기본 off, AI 운영 compose는 worker만 on; `EMBED_DELETE` 미구현(DLQ) |
| ai-worker→Spring download-url·callback | 양쪽 구현 |
| ai-api·ai-worker→bge-runtime | client·runtime·reverse tunnel·운영 container proxy 배선 구현 |
| Spring→LiveKit→realtime-agent | 양쪽 dispatch 구현, job readiness 우회 중 |
| realtime-agent→Redis caption | producer·ai-api consumer 구현, Spring consumer 미구현 |
| realtime-agent→Spring lifecycle | AI 구현·기본 off, Spring receiver 미구현 |
| realtime-agent `/health/live`·`/health/ready` | endpoint·schema·tunnel 구현, Spring client 미구현 |

## 7. 관련 문서

- [AI 통신 계약 지도](../docs/ai/CONTRACT.md)
- [전체 공유 계약](../docs/CONTRACT.md)
- [전체 아키텍처](../docs/ARCHITECTURE.md)
- [통합 실행 가이드](../RUN.md)
- [GPU realtime-agent 운영](../docs/ai/GPU-REALTIME-AGENT-RUNBOOK.md)
- [EC2 AI 운영 compose](../docker-compose.ai-prod.yml)
