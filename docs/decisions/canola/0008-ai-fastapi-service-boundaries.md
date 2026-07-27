# ADR-0008: AI Python 서비스를 독립 프로젝트로 구성한다

- **상태**: 채택
- **일자**: 2026-07-24
- **관련**: [songjeongki ADR-0011](../songjeongki/0011-ai-three-services.md), [songjeongki ADR-0012](../songjeongki/0012-hybrid-queue.md)

## 맥락

ADR-0011은 `ai-api`, `ai-worker`, `realtime-agent`를 수명주기가 다른 배포 단위로 분리했다.
첫 구현 단계에서 HTTP 프로세스와 배치 프로세스가 의존성, 설정, 테스트 환경까지 공유하면 한
서비스의 변경이 다른 서비스의 배포를 불필요하게 묶는다. 구현 전에도 process health와 readiness를
독립적으로 확인할 수 있는 최소 실행 경계가 필요하다.

## 결정

- `ai-api`와 `ai-worker`를 Python 3.12 독립 프로젝트로 시작한다.
- 각 서비스가 자체 `pyproject.toml`과 `uv.lock`을 소유하고 `uv`로 재현 가능한 환경을 만든다.
- `ai-api`는 FastAPI application lifecycle과 `/healthz`, `/readyz`만 먼저 제공한다.
- `ai-worker`는 asyncio worker lifecycle과 외부 ingress에 노출하지 않는 FastAPI 관리 probe만
  제공한다.
- 두 관리 서버는 기본적으로 loopback에 bind한다.
- RAG API, RabbitMQ consumer, Spring↔AI 인증과 payload 계약은 실제 양쪽 소비자를 구현하는 후속
  MR에서 계약 테스트와 함께 추가한다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| 루트 Python 프로젝트 하나 | 초기 파일 수가 적음 | 서비스별 의존성과 배포 수명주기가 결합됨 |
| lockfile 하나를 공유 | 일괄 업그레이드가 쉬움 | 한 서비스의 라이브러리 변경이 모든 서비스를 재검증하게 함 |
| **서비스별 프로젝트와 lockfile** | 독립 배포·검증, 변경 범위 격리 | lockfile과 업데이트 작업이 늘어남 |

## 영향

- 서비스별로 pytest와 Ruff를 실행한다.
- 이번 결정은 Java 코드, API payload, 상태코드, Redis/LiveKit 설정을 바꾸지 않는다.
- 공유 계약이 없으므로 Java 계약 테스트는 필요하지 않고, 각 Python 프로세스의 lifecycle과 probe를
  단위 테스트로 검증한다.
