# ai-api

EC2에서 실행하는 Spring 전용 FastAPI 서비스다. 관리 probe와 함께 RAG 질문을 근거 조회·답변 생성
port로 전달하고 계약화된 SSE event로 내보내는 수직 코어를 제공한다.

```bash
cd ai/ai-api
uv sync --frozen
uv run --frozen python -m app.main
```

- `GET /healthz`: 프로세스 생존
- `GET /readyz`: application lifespan 준비 상태
- `POST /internal/v1/rag/answers:stream`: Spring 전용 RAG SSE 후보 경계
- 기본 주소: `127.0.0.1:8010`

현재 실행 entrypoint에는 실제 근거 검색, 모델, Spring 인증 검증기를 연결하지 않았으므로 RAG endpoint는
fail-closed `503`이다. 테스트에서는 fake port로 수직 흐름을 검증한다. 이 서비스를 브라우저에 직접
노출하지 않으며 Java 채택 전 후보 계약은 [`CONTRACT.md`](CONTRACT.md)를 따른다.

## 폴더별 상세 문서

| 폴더 | 설명 |
|---|---|
| [`app/`](app/README.md) | FastAPI 생명주기·RAG 코어·내부 HTTP 경계 |
| [`docs/`](docs/README.md) | ai-api 한정 기술 결정 기록 |
| [`tests/`](tests/README.md) | 관리 endpoint와 RAG 계약·스트림 검증 |

```bash
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests
```
