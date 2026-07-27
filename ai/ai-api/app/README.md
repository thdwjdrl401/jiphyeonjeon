# `ai-api/app`

Spring 전용 `ai-api`의 실행 골격과 RAG application core다.

## 역할

- `AI_API_*` 설정을 검증하고 FastAPI를 실행한다.
- application lifespan에 맞춰 readiness를 전환한다.
- 구조화 JSON logging과 관리 endpoint를 제공한다.
- RAG 요청을 근거 검색과 답변 모델 port로 조율하고 SSE event로 변환한다.
- Spring 내부 인증 구현을 교체 가능한 port 뒤에 두고, 미배선 상태는 fail-closed 처리한다.

## 구조와 흐름

```text
Spring -> api/rag.py -> rag/service.py -> EvidenceRetriever + AnswerModel
                                      `-> named SSE events -> Spring
```

| 요청 | 응답 |
|---|---|
| `GET /healthz` | `200 {"status":"ok","service":"ai-api"}` |
| `GET /readyz` | lifespan 중 `200 {"status":"ready","service":"ai-api"}` |
| `GET /readyz` | 시작 전·종료 후 `503 {"status":"not_ready","service":"ai-api"}` |
| `POST /internal/v1/rag/answers:stream` | 인증·Accept·body 검증 후 named SSE stream |

## 파일 구성

| 파일 | 책임 |
|---|---|
| `main.py` | FastAPI factory, lifespan, endpoint, uvicorn 실행 |
| `config.py` | host·port·환경·로그 수준 검증 |
| `runtime.py` | process readiness 상태 |
| `logging_config.py` | 공통 context 기반 JSON 로그 |
| [`api/`](api/README.md) | 내부 인증 seam과 FastAPI RAG adapter |
| [`rag/`](rag/README.md) | transport-neutral 계약·port·오케스트레이션·SSE 인코딩 |

## 경계와 불변식

- 브라우저에 직접 노출하지 않는다.
- 실제 Spring 단명 토큰 검증기, Redis/pgvector/BGE retrieval, GMS model은 아직 배선하지 않았다.
- 인증기나 RAG service가 없으면 요청을 허용하지 않고 `503`으로 닫는다.
- 근거가 부족하면 모델을 호출하지 않으며, 충분한 답변은 하나 이상의 citation을 포함한다.
- 모든 시작된 SSE stream은 `answer.done|answer.insufficient|answer.error` 중 하나로 끝난다.
- `/readyz`는 외부 dependency 준비 상태가 아니라 application lifespan 상태다.

## 검증

```bash
cd ai/ai-api
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests
```
