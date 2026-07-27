# `ai-worker/app`

배치 worker의 process 골격과 transport-neutral PPTX ingestion core를 담는다.

## 역할

- 설정·signal·관리 FastAPI server와 runtime readiness를 관리한다.
- PPTX index use case, port, pgvector 저장 구현을 제공한다.

## 구조와 흐름

```text
StagedMaterial -> application/ -> ingestion/ -> ports/ <- adapters/
python -m app.main -> WorkerRuntime + management FastAPI
```

관리 API는 `GET /healthz`의 `200 status=ok`와, runtime 상태에 따라 `200 ready` 또는 `503 not_ready`를
반환하는 `GET /readyz`다. RabbitMQ 업무 API는 아직 없다.

## 파일 구성

`main.py`, `config.py`, `runtime.py`, `management.py`, `database_urls.py`, `logging_config.py`와 아래
도메인·유스케이스·port·adapter package로 구성된다.

## 경계와 불변식

- 현재 `app.main`은 ingestion job을 consume하지 않는다.
- 관리 HTTP를 외부 ingress에 노출하지 않는다.
- async runtime URL과 sync migration URL의 driver를 혼용하지 않는다.

## 검증

```bash
cd ai/ai-worker
uv run --frozen pytest -q -p no:cacheprovider
```
