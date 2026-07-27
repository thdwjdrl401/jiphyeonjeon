# `ai-api/app`

Spring 전용 `ai-api`의 현재 실행 골격이다.

## 역할

- `AI_API_*` 설정을 검증하고 FastAPI를 실행한다.
- application lifespan에 맞춰 readiness를 전환한다.
- 구조화 JSON logging과 관리 endpoint를 제공한다.

## 구조와 흐름

```text
python -m app.main -> Settings -> FastAPI lifespan -> health/readiness
```

현재 통신 API는 관리 probe뿐이다.

| 요청 | 응답 |
|---|---|
| `GET /healthz` | `200 {"status":"ok","service":"ai-api"}` |
| `GET /readyz` | lifespan 중 `200 {"status":"ready","service":"ai-api"}` |
| `GET /readyz` | 시작 전·종료 후 `503 {"status":"not_ready","service":"ai-api"}` |

## 파일 구성

| 파일 | 책임 |
|---|---|
| `main.py` | FastAPI factory, lifespan, endpoint, uvicorn 실행 |
| `config.py` | host·port·환경·로그 수준 검증 |
| `runtime.py` | process readiness 상태 |
| `logging_config.py` | 공통 context 기반 JSON 로그 |

## 경계와 불변식

- RAG/SSE 업무 API와 Spring 인증은 아직 구현되지 않았다.
- 브라우저에 직접 노출하지 않는다.
- `/readyz`는 외부 dependency 준비 상태가 아니라 application lifespan 상태다.

## 검증

```bash
cd ai/ai-api
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests
```
