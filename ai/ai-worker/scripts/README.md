# `ai-worker/scripts`

배포 프로세스가 아니라 명시적으로 실행하는 통합 검증 도구를 둔다.

`e2e_material_ingestion.py`는 실행 중인 Spring에 강사로 가입·로그인한 뒤 작은 PPTX를 presigned 방식으로
업로드하고 레슨에 연결한다. 이후 callback으로 `embeddingStatus=READY`가 될 때까지 기다리고, PostgreSQL의
`ai.material_version`, `ai.document_chunk`, `ai.chunk_embedding`을 직접 확인한다.

이 스크립트는 실제 사용자·커리큘럼·레슨·자료 레코드를 만들며 자동 삭제하지 않는다. 삭제 consumer가 별도
하드닝 범위이기 때문이다. 격리된 로컬 DB에서만 실행하고 필요하면 Compose 볼륨을 명시적으로 초기화한다.

필요 서비스와 환경변수, 실행 순서는
[E2E runbook](../../../docs/decisions/canola/0021-material-ingestion-e2e-runbook.md)에 모아 관리한다.
2026-07-27 실제 CUDA BGE를 사용한 두 번의 실행에서 `ACTIVE`, 1 chunk/embedding, 1024차원을 확인했다.
