# `ai-worker/app`

배치 worker process와 transport-neutral PPTX ingestion core, opt-in RabbitMQ 실행 배선을 담는다.

## 역할

- 설정·signal·관리 FastAPI server와 runtime readiness를 관리한다.
- PPTX index use case, port, pgvector 저장 구현을 제공한다.
- Spring이 선언한 `ingestion.embed`를 passive lookup하고 완료 callback 뒤 ACK한다.
- `AI_WORKER_KEY_TERM_EXTRACTION_ENABLED=true`일 때 GMS로 PPTX 핵심 용어+정의를 임베딩과 동시에
  추출한다(기본 off, 실패해도 기존 인덱싱을 막지 않음).
- 추출된 용어는 기존 `MATERIAL_EMBEDDED` Spring 콜백에 `keyTerms`로 실어 한 번에 전달하는 동시에,
  `ai.material_key_term`에도 best-effort로 저장한다(ADR-0005). 재시도 시 콜백 용어가 사라지지
  않도록 job_id 기준 in-memory 캐시로 잠깐 기억해둔다(ADR-0004).
- `EMBED_DELETE`는 payload에 없는 curriculum_id를 materialId로 self-lookup한 뒤 삭제한다(ADR-0006).
  지울 게 없으면 성공(멱등)으로 끝낸다.

## 구조와 흐름

```text
RabbitMQ -> consumers/ -> application/IndexPptxMaterial   -> ingestion/ -> ports/ <- adapters/
                                                            -> (선택) GMS key term 추출 -> ports/ <- adapters/
                        -> application/DeleteMaterialIndex -> ports/ <- adapters/ (self-lookup)
python -m app.main -> WorkerRuntime -> RabbitMaterialConsumer + management FastAPI
```

관리 API는 `GET /healthz`의 `200 status=ok`와, runtime 상태에 따라 `200 ready` 또는 `503 not_ready`를
반환하는 `GET /readyz`다. consumer가 켜지면 RabbitMQ, PostgreSQL, tunnel을 통한 BGE `/readyz`가 모두 준비돼야 ready가 된다.
RabbitMQ는 HTTP 업무 API가 아니라 비동기 입력 transport다.

## 파일 구성

`main.py`, `config.py`, `runtime.py`, `management.py`, `database_urls.py`, `logging_config.py`와 아래
도메인·유스케이스·port·adapter package로 구성된다.

## 경계와 불변식

- `AI_WORKER_MATERIAL_INGESTION_ENABLED=false`가 기본이며, true일 때만 job을 consume한다.
- queue는 Java 소유 선언과 충돌하지 않도록 passive lookup한다.
- 관리 HTTP를 외부 ingress에 노출하지 않는다.
- async runtime URL과 sync migration URL의 driver를 혼용하지 않는다.

## 검증

```bash
cd ai/ai-worker
uv run --frozen pytest -q -p no:cacheprovider
```
