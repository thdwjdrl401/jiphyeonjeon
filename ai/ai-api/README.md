# ai-api

EC2에서 실행하는 Spring 전용 FastAPI 서비스다. 관리 probe와 함께 RAG 질문을 근거 조회·답변 생성
port로 전달하고 GMS 답변을 계약화된 SSE event로 내보내는 수직 흐름을 제공한다.
최근 자막은 application Redis의 독립 consumer group으로 읽고, 자료는 BGE-M3 query embedding과
Python 소유 pgvector ACTIVE index를 함께 검색한다.

```bash
cd ai/ai-api
uv sync --frozen
uv run --frozen python -m app.main
```

- `GET /healthz`: 프로세스 생존
- `GET /readyz`: application lifespan 준비 상태
- `POST /internal/v1/rag/answers:stream`: Spring 전용 RAG SSE 후보 경계
- 기본 주소: `127.0.0.1:8010`

실행 entrypoint는 Redis caption consumer, pgvector/BGE context와 GMS client를 application lifespan에
연결한다. 실행에는 `AI_API_DATABASE_URL`, `AI_API_BGE_BASE_URL`, `AI_API_BGE_TOKEN`,
`AI_API_GMS_API_KEY`가 필요하다. Spring→ai-api 내부 인증은 HMAC 공유 시크릿(ADR-0023 §9)으로 채택
확정됐고, `AI_INTERNAL_SECRET`이 설정되면 `HmacInternalRequestAuthenticator`가 실제로 배선된다.
미설정 시에는 계속 fail-closed `503`이며, Spring 쪽 서명 발급기가 아직 없어 실제 상호 인증까지는
안 된 상태다. 이 서비스를 브라우저에 직접 노출하지 않으며 Java 채택 전 후보 계약은
[`CONTRACT.md`](CONTRACT.md)를 따른다.

로컬 검증은 기본 compose의 PostgreSQL·Redis를 사용한다. PostgreSQL 테스트는 실행마다 별도 `*_test` DB와
role을 만들고 제거하며, Redis 테스트는 DB 15의 무작위 key만 사용한다. 둘 다 skip하지 않는다.

```bash
docker compose up -d postgres redis
cd ai/ai-api
uv run --frozen pytest -q -p no:cacheprovider
```

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
