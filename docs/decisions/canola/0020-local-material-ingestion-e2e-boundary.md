# ADR-0020: 로컬 자료 인제스트 E2E는 Docker 인프라와 host 애플리케이션을 결합한다

- 상태: 채택
- 날짜: 2026-07-27

## 맥락

강사 PPTX 업로드부터 pgvector 저장·Spring READY callback까지 검증하려면 PostgreSQL, Redis, MinIO,
RabbitMQ, Spring, ai-worker와 BGE-M3가 동시에 필요하다. 현재 Spring의 local presigner는
설정된 `http://127.0.0.1:19000` URL을 발급한다. worker를 bridge network container에 넣으면 이 localhost는
worker container 자신을 가리켜 MinIO 다운로드가 깨진다.

RAG 병렬 작업은 `ai/ai-api/**`를 소유하므로 인제스트 검증이 그 경로와 root 기존 Compose 파일을 수정하면
병합 충돌도 커진다.

## 결정

- 기존 `docker-compose.yml`은 건드리지 않고 `docker-compose.material-ingestion.yml`에 전용 project·volume·
  host port를 가진 격리 인프라와 선택적 GPU BGE runtime을 둔다.
- local E2E의 Spring과 ai-worker는 host에서 실행한다. 둘 다 같은 `127.0.0.1:19000` capability URL을 읽어
  운영과 다른 URL rewrite를 코드에 넣지 않는다.
- 실제 HTTP 강사 흐름과 최종 AI 테이블을 함께 확인하는 `scripts/e2e_material_ingestion.py`를 둔다.
- worker와 BGE에는 독립 non-root Dockerfile을 제공하되, local E2E에서 worker image 사용을 강제하지 않는다.
- `ai/ai-api/**`와 retrieval/query/RRF/answer 코드는 이 변경 범위에서 제외한다.

## 결과

- 실제 업로드·queue·GPU·DB·callback 경로를 재현할 수 있고 RAG 브랜치 및 다른 개발자의 실행 컨테이너·
  데이터와 충돌하지 않는다.
- local worker는 host process라 production container network 검증과 동일하지 않다. worker image health smoke와
  실제 서버 network E2E는 별도 배포 gate에서 추가한다.
- `EMBED_DELETE` resolver는 이 happy-path 활성화와 분리된 하드닝 항목으로 유지한다.
