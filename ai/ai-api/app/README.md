# `ai-api/app`

Spring 전용 `ai-api`의 실행 골격과 RAG application core다.

## 역할

- `AI_API_*` 설정을 검증하고 FastAPI를 실행한다.
- application lifespan에 맞춰 readiness를 전환한다.
- 구조화 JSON logging과 관리 endpoint를 제공한다.
- RAG 요청을 근거 검색과 답변 모델 port로 조율하고 SSE event로 변환한다.
- realtime-agent caption을 attempt 단위 rolling context로 접고 ACTIVE PPTX index와 결합한다.
- remote BGE query embedding과 SELECT-only pgvector hybrid 검색 adapter를 제공한다.
- 근거만 포함한 prompt를 고정 GMS gateway로 보내 답변 text delta를 streaming한다.
- 한 process에서 active/recent `requestId`를 제한하고 Redis consumer와 외부 client 생명주기를 소유한다.
- Spring 내부 인증 구현을 교체 가능한 port 뒤에 두고, 미배선 상태는 fail-closed 처리한다.

## 구조와 흐름

```text
realtime-agent -> Redis Streams -> captions/store.py --.
BGE runtime -> query vector -> pgvector ACTIVE chunks ---+-> CombinedEvidenceRetriever
Spring -> api/rag.py -> request registry -> rag/service.py+-> GMS AnswerModel -> SSE
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
| `config.py` | process·Redis·DB·BGE·retrieval 설정 검증 |
| `runtime.py` | process readiness와 caption consumer task 시작·종료 |
| `logging_config.py` | 공통 context 기반 JSON 로그 |
| `wiring.py` | context·GMS·registry·RAG service 조립과 close 경계 |
| [`adapters/`](adapters/README.md) | Redis consumer, pgvector search, remote BGE client |
| [`api/`](api/README.md) | 내부 인증 seam과 FastAPI RAG adapter |
| [`captions/`](captions/README.md) | current producer 계약 parser와 attempt-aware bounded store |
| [`rag/`](rag/README.md) | transport-neutral 계약·port·오케스트레이션·SSE 인코딩 |
| [`retrieval/`](retrieval/README.md) | query embedding 검증과 ACTIVE material 검색 service |

## 경계와 불변식

- 브라우저에 직접 노출하지 않는다.
- 실제 Spring 단명 토큰 검증기는 아직 배선하지 않았다. 고정 secret으로 우회하지 않으며 이 상태에서는
  context와 GMS가 구성되어도 production endpoint가 `503`으로 닫힌다.
- application Redis 기본 주소는 `6379`이며 LiveKit 내부 Redis나 host `6380`을 전제로 하지 않는다.
- 인증기나 RAG service가 없으면 요청을 허용하지 않고 `503`으로 닫는다.
- 근거가 부족하면 모델을 호출하지 않으며, 충분한 답변은 하나 이상의 citation을 포함한다.
- 모든 시작된 SSE stream은 `answer.done|answer.insufficient|answer.error` 중 하나로 끝난다.
- `/readyz`는 외부 dependency 준비 상태가 아니라 application lifespan 상태다.
- request registry는 process-local이므로 현재 단일 replica 전제다.

## 검증

```bash
cd ai/ai-api
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests
```
