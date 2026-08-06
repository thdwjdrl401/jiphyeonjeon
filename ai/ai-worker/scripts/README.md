# `ai-worker/scripts`

배포 프로세스가 아니라 명시적으로 실행하는 통합 검증 도구를 둔다.

## EC2 → GPU BGE 통신 smoke

`smoke_remote_bge.py`는 EC2 host에서 `127.0.0.1:18020` reverse tunnel을 통해 GPU BGE에 실제 HTTP
요청을 보낸다. `/readyz`, Bearer 인증, pinned model·revision, 두 입력의 1024차원 정규화 vector를 검증한다.
원문 probe·embedding vector·token은 출력하지 않고 계약 metadata와 latency만 출력한다.

EC2에 ai-worker와 동일한 환경변수를 주입한 뒤 ai-worker project root에서 실행한다. secret을 명령행 인자로
넘기지 않는다.

```bash
export AI_WORKER_BGE_RUNTIME_URL=http://127.0.0.1:18020
# AI_WORKER_BGE_INTERNAL_TOKEN은 EC2 secret 환경에서 주입
uv run --frozen python -m scripts.smoke_remote_bge
```

성공 출력은 아래 형태다.

```json
{"count":2,"dimensions":[1024],"embeddingMs":123.4,"maxNormError":0.0,"model":"BAAI/bge-m3","revision":"5617a9f61b028005a4858fdac845db406aefb181","runtimeUrl":"http://127.0.0.1:18020","status":"ok"}
```

이 smoke는 EC2→tunnel→GPU→EC2 요청/응답만 검증한다. Spring·RabbitMQ·pgvector·callback까지 포함하는 최종
검증은 아래 `e2e_material_ingestion.py`를 사용한다.

## 자료 임베딩 전체 E2E

`e2e_material_ingestion.py`는 실행 중인 Spring에 강사로 가입·로그인한 뒤 작은 PPTX를 presigned 방식으로
업로드하고 레슨에 연결한다. 이후 callback으로 `embeddingStatus=READY`가 될 때까지 기다리고, PostgreSQL의
`ai.material_version`, `ai.document_chunk`, `ai.chunk_embedding`을 직접 확인한다.

이 스크립트는 실제 사용자·커리큘럼·레슨·자료 레코드를 만들며 자동 삭제하지 않는다. 삭제 consumer가 별도
하드닝 범위이기 때문이다. 격리된 로컬 DB에서만 실행하고 필요하면 Compose 볼륨을 명시적으로 초기화한다.

필요 서비스와 환경변수, 실행 순서는
[E2E runbook](../../../docs/decisions/canola/0021-material-ingestion-e2e-runbook.md)에 모아 관리한다.
2026-07-27 실제 CUDA BGE를 사용한 두 번의 실행에서 `ACTIVE`, 1 chunk/embedding, 1024차원을 확인했다.
