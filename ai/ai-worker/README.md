# ai-worker

EC2에서 실행하는 배치 AI 작업 프로세스 골격이다. 현재는 lifecycle과 관리 probe만 제공하며 RabbitMQ
PPTX ingestion은 후속 MR에서 구현한다.

```bash
cd ai/ai-worker
uv sync --frozen
AI_WORKER_INSTANCE_ID=worker-1 uv run --frozen python -m app.main
```

관리 HTTP는 업무 API가 아니며 기본 `127.0.0.1:8011`에만 열린다.

- `GET /healthz`: 프로세스 생존
- `GET /readyz`: worker event loop 준비 상태

RabbitMQ consumer를 추가할 때 readiness는 연결과 consumer 준비 상태도 함께 확인한다. 컨테이너 probe 때문에
`AI_WORKER_MANAGEMENT_HOST=0.0.0.0`을 사용하더라도 외부 ingress에는 포트를 노출하지 않는다.

```bash
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check app tests
```
