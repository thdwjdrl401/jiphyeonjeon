# AI services

Python 3.12와 `uv`를 사용하는 LiveClass AI 서비스 모음이다. 각 서비스는 의존성과
lockfile을 독립적으로 관리한다.

| 서비스 | 역할 | 기본 관리 주소 |
|---|---|---|
| [`ai-api`](ai-api/README.md) | Spring 내부 호출용 FastAPI 프로세스 골격 | `127.0.0.1:8010` |
| [`ai-worker`](ai-worker/README.md) | 비동기 AI 작업 프로세스 골격 | `127.0.0.1:8011` |

현재 범위는 설정 로딩, 구조화 로그, lifecycle, health/readiness probe까지다. RAG API,
RabbitMQ consumer, 공유 도메인 계약은 후속 MR에서 추가한다.

실행과 검증 명령은 각 서비스 README를 따른다.
