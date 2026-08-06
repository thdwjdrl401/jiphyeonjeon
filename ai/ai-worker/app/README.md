# `ai-worker/app`

배치 worker process와 transport-neutral PPTX ingestion core, opt-in RabbitMQ 실행 배선을 담는다.

## 역할

- 설정·signal·관리 FastAPI server와 runtime readiness를 관리한다.
- PPTX index use case, port, pgvector 저장 구현을 제공한다.
- Spring이 선언한 `ingestion.embed`를 passive lookup하고 완료 callback 뒤 ACK한다.
- v2 `extractKeyTerms=true` 또는 v1 feature flag 요청 시 GMS로 PPTX 핵심 용어+정의를 임베딩과
  동시에 추출한다. 실패는 별도 `keyTermResult=FAILED`로 보고하고 기존 인덱싱은 계속한다.
- 용어와 `READY|EMPTY|FAILED` 결과를 material version에 영속화하고, 재배달 시 DB 결과로 callback을
  재구성한다. Spring callback에는 원문 복사 대신 상태·개수·절단 여부를 전달한다(ADR-0010).
- `EMBED_DELETE`는 payload에 없는 curriculum_id를 materialId로 self-lookup한 뒤 삭제한다(ADR-0006).
  지울 게 없으면 성공(멱등)으로 끝낸다.
- `AI_WORKER_ANNOTATION_INGESTION_ENABLED=true`면 `ANNOTATION_EMBED`/`ANNOTATION_EMBED_DELETE`도
  같은 queue에서 처리한다. Spring이 보낸 text를 임베딩·저장만 하며, 꺼져 있으면 DLQ로 보낸다(ADR-0074).

## 구조와 흐름

```text
RabbitMQ -> consumers/ -> application/IndexPptxMaterial   -> ingestion/ -> ports/ <- adapters/
                                                            -> (선택) GMS key term 추출 -> ports/ <- adapters/
                        -> application/DeleteMaterialIndex -> ports/ <- adapters/ (self-lookup)
                        -> application/IndexAnnotationHighlight    -> ports/ <- adapters/
                        -> application/DeleteAnnotationHighlight   -> ports/ <- adapters/
python -m app.main -> WorkerRuntime -> RabbitMaterialConsumer + management FastAPI
```

관리 API는 `GET /healthz`의 `200 status=ok`와, runtime 상태에 따라 `200 ready` 또는 `503 not_ready`를
반환하는 `GET /readyz`다. consumer가 켜지면 RabbitMQ, PostgreSQL, tunnel을 통한 BGE `/readyz`가 모두 준비돼야 ready가 된다.
RabbitMQ는 HTTP 업무 API가 아니라 비동기 입력 transport다.

## 파일 구성

`main.py`, `config.py`, `runtime.py`, `management.py`, `database_urls.py`, `logging_config.py`와
`contracts/`(wire 계약), `consumers/`(job handler), `ingestion/`, 아래 도메인·유스케이스·port·adapter
package로 구성된다. `recorded_stt/`는 같은 tree에 있지만 `python -m app.recorded_stt.main`으로
따로 뜨는 별도 process이며, `RECORDED_STT_` prefix 설정과 `ingestion.transcribe` queue를 쓴다.

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
