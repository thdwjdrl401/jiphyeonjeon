# ai-api

EC2에서 실행하는 Spring 전용 FastAPI 서비스다. 현재는 프로세스 생존성과 설정 경계만 제공하며
RAG/SSE 업무 API는 후속 MR에서 구현한다.

```bash
cd ai/ai-api
uv sync --frozen
uv run --frozen python -m app.main
```

- `GET /healthz`: 프로세스 생존
- `GET /readyz`: application lifespan 준비 상태
- 기본 주소: `127.0.0.1:8010`

업무 API와 Spring↔AI 인증 경계는 후속 계약 MR에서 함께 추가한다. 이 서비스를 브라우저에 직접
노출하지 않는다.

```bash
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests
```
