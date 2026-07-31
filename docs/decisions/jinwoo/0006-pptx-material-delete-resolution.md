# ADR-0006: PPTX 자료 삭제 요청은 ai-worker가 curriculum_id를 self-lookup해서 처리한다

- 상태: 채택
- 일자: 2026-07-31
- 관련: [ADR-0005](0005-key-term-storage-schema.md), `ai/ai-worker/app/consumers/material_job.py`,
  `ai/ai-worker/app/adapters/pgvector_index.py`

## 맥락

`EMBED_DELETE` job(`{taskType, materialId, lessonId, contractVersion}`)은 계약에는 이미 있고,
DB에서 실제로 지우는 `PgvectorIndexRepository.delete_job()`도 이미 구현·테스트돼 있다. 하지만
`MaterialJobHandler.handle()`은 지금 `EMBED_DELETE`를 받으면 무조건 거부하고 DLQ로 보낸다 — 이유는
`delete_job()`이 스코프 안전 검증(`_assert_material_scope`)에 `curriculum_id`를 요구하는데,
`EMBED_DELETE` payload엔 `materialId`·`lessonId`만 오고 `curriculum_id`가 없기 때문이다.

## 결정

ai-worker가 `material_id`로 `ai.material_version`을 먼저 조회해 `curriculum_id`와 현재 최대
`material_version`을 스스로 알아낸 뒤 삭제를 진행한다. Spring 쪽 wire 계약은 바꾸지 않는다.

이 방식이 안전한 이유는 ADR-0005(RAG 커리큘럼 공유)의 self-lookup 거부 사유가 여기엔 적용되지
않기 때문이다 — ADR-0005는 "아직 자료가 없는 새 세션"에서 self-lookup이 실패하는 문제였지만,
삭제 대상은 정의상 **이미 임베딩된 자료**라 조회가 실패할 수 없다(있으면 지우고, 없으면 이미 지워진
것으로 간주해 성공 처리한다).

### 대안: Spring이 `curriculumId`를 payload에 추가

- 장점: ai-worker가 DB를 미리 조회할 필요 없음.
- 단점: ADR-0005와 똑같은 Spring 쪽 계약 변경·배포 순서 의존이 또 생긴다. self-lookup으로 이미
  충분히 안전한데 굳이 외부 의존을 추가할 이유가 없어 채택하지 않는다.

## 세부 동작

- `resolve_active_scope(tenant_id, material_id)`: `ai.material_version`에서 해당 material의
  `curriculum_id`·`lesson_id`·최대 `material_version`을 조회한다. 행이 없으면 `None` — "지울 게
  없음"으로 간주해 성공(멱등)으로 끝낸다.
- 조회된 `curriculum_id`와 wire의 `lesson_id`로 `StagedMaterial`을 구성해 기존 `delete_job()`을
  그대로 호출한다. wire의 `lesson_id`가 실제 저장된 값과 다르면 `delete_job()` 내부의
  `_assert_material_scope`가 이미 거부한다 — 별도 검증 코드를 추가하지 않는다.
- `delete_job()`은 `StagedMaterial`의 embedding 전용 필드(`source_bucket`,
  `chunk_strategy`, `model_name`, `model_revision`)를 전혀 읽지 않는다(SQL이 명시적으로 필요한
  키만 바인딩). 삭제 전용 타입을 새로 만드는 대신 기존 타입에 유효하지만 의미 없는 placeholder
  값을 채워 넣는다 — 기존 테스트(`test_pgvector_repository.py`)가 이미 같은 패턴을 쓰고 있어
  일관적이고, `delete_job()` 시그니처·6곳 이상의 기존 테스트를 건드리는 리팩터링을 피한다.
- 성공 콜백은 새 eventType `MATERIAL_DELETED`(status `DELETED`)로, 실패는
  `MATERIAL_DELETE_FAILED`(status `FAILED`)로 보낸다. 루트 계약(`docs/CONTRACT.md` §3-2)은 알 수
  없는 eventType을 inbox에만 남기고 상태를 바꾸지 않는다고 명시하므로, Spring이 아직 이 이벤트를
  처리하지 않아도 무해하다.

## 결과

- Spring 쪽 추가 배선(`keyTerms` 소비, `curriculumId` payload 추가) 없이 이번 브랜치만으로 동작한다.
- 알려진 한계: self-lookup과 `delete_job()`의 실제 삭제 트랜잭션 사이에는 락이 없는 짧은 시간차가
  있다. 그 사이 같은 자료가 더 높은 버전으로 재임베딩되면 `delete_job()`이
  `StaleMaterialVersionError`로 안전하게 거부한다(삭제 자체는 막되 잘못 지우지는 않는다) — 이 경우
  기존 재시도 분류상 non-retryable 처리되어 실패 콜백이 나간다. 드문 경쟁 상황이라 별도 재시도
  로직을 추가하지 않는다.
