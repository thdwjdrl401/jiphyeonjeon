# AI services

Python 3.12와 `uv`를 사용하는 LiveClass AI 서비스 모음이다. 각 서비스는 의존성과
lockfile을 독립적으로 관리한다.

| 서비스 | 역할 | 기본 관리 주소 |
|---|---|---|
| [`ai-api`](ai-api/README.md) | RAG SSE 코어와 Redis caption·pgvector/BGE context adapter | `127.0.0.1:8010` |
| [`ai-worker`](ai-worker/README.md) | 비동기 AI 작업 프로세스 골격 | `127.0.0.1:8011` |
| [`realtime-agent`](realtime-agent/README.md) | LiveKit 강사 오디오→STT→Redis caption agent | LiveKit AgentServer |
| [`bge-runtime`](bge-runtime/README.md) | 인증된 BGE-M3 내부 GPU embedding runtime | `127.0.0.1:8020` |

현재 범위는 ai-api의 RAG 요청→Redis/pgvector/BGE 근거 조회→답변 port→SSE terminal 골격, ai-worker의 PPTX
ingestion/index 저장, realtime-agent의 runnable AgentServer·오디오·VAD·STT provider·AI-side lifecycle
계약, 독립 BGE-M3 runtime까지다. Java가 아직 채택하지 않은 Python 경계는 각 서비스의 후보 계약으로
관리하며 공유 `docs/CONTRACT.md`를 확정 변경하지 않는다. ai-api의 GMS 답변 model·request registry와
production lifecycle/auth 배선, Java의 live caption dispatch/consumer는 후속 MR에서 추가한다.

실행과 검증 명령은 각 서비스 README를 따른다.

## 폴더별 문서

각 서비스 README에서 실행 코드와 테스트 폴더의 상세 README로 이어진다. `.venv*`, `.uv-cache*`,
`.pytest*`, `__pycache__`, `models/`는 로컬 생성 자산이므로 대상에서 제외한다.
