# ADR-0045: 커리큘럼 종속 자료를 lesson_id 없이 색인한다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책:
> [../../harness/POLICY.md](../../harness/POLICY.md) · 공유 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 승인 — 구현 완료
- **일자**: 2026-08-04
- **적용 범위**: `ai-worker`(계약·도메인·저장), `ai-api`(검색 결과 읽기), `ai.material_version`·`ai.job_run`
- **관련**:
  [docs/ai/CONTRACT.md §9](../../ai/CONTRACT.md)(제안 원문),
  [songjeongki/ADR-0042](../songjeongki/0042-curriculum-material-attach-and-embedding-scope.md)(Spring 발행 구현),
  [jinwoo/ADR-0007](../jinwoo/0007-curriculum-scoped-rag-material-sharing.md)(커리큘럼 검색 스코프),
  [jinwoo/ADR-0006](../jinwoo/0006-pptx-material-delete-resolution.md)(삭제 self-lookup)

## 맥락

자료는 두 수준에 붙는다 — **커리큘럼 종속**(커리큘럼 전체에서 항상 참조)과 **레슨 종속**(그 강의
문맥에서 추가 참조). Spring은 이미 두 종류를 모두 발행하고 있었지만, 워커는 `PptxEmbedJob`이
`lessonId`를 필수로 요구하고 `scope`를 미지 필드로 거부해 커리큘럼 잡을 전부 떨어뜨렸다.

운영 DLQ에서 실제로 확인했다 — `scope:"CURRICULUM"` PPTX 잡 3건이 쌓여 있었고, 원문을 파서에
먹여보니 `lessonId: Field required` + `scope: Extra inputs are not permitted`로 거부됐다. §9가
"AI 오너 구현 대기"로 남아 있는 동안 실제 트래픽이 유실되고 있었다.

## 결정

### 1. lesson_id를 nullable로 만든다 (스코프를 별도 컬럼으로 두지 않는다)

`ai.material_version.lesson_id`와 `ai.job_run.lesson_id`의 NOT NULL을 푼다(alembic `0006`).
**`lesson_id IS NULL`이 곧 "커리큘럼 종속"** 이며 별도 `scope` 컬럼을 만들지 않는다 — 두 값이
어긋날 수 있는 표현을 애초에 만들지 않기 위해서다.

검색은 바꿀 것이 없다. ADR-0007로 `ACTIVE_MATERIAL_HYBRID_SQL`이 이미 `curriculum_id`만으로
필터하므로, NULL 행은 색인되는 순간 자동으로 검색에 포함된다.

### 2. wire는 scope와 lesson의 짝을 양방향으로 강제한다

`scope`는 `CURRICULUM | LESSON | None`이고, Spring은 레슨 잡에 `scope`를 아예 싣지 않으므로
**없으면 LESSON**이다. 짝 검증은 두 방향 모두 건다.

- `CURRICULUM`인데 `lessonId`가 있으면 거부 — 모순된 payload다.
- `scope`가 없거나 `LESSON`인데 `lessonId`가 없으면 거부 — **이쪽이 더 중요하다.** 레슨 잡이
  `lessonId`를 잃으면 조용히 커리큘럼 전체 자료가 되어, 한 강의 자료가 커리큘럼 모든 질문의
  근거로 새어 나간다.

삭제 봉투는 스코프별로 **비대칭**이다(레슨은 `lessonId`, 커리큘럼은 `curriculumId`). Spring이
실제로 그렇게 보내므로 그대로 수용한다 — 대칭으로 강제하면 커리큘럼 삭제가 DLQ로 간다.

### 3. 스코프 가드는 `IS DISTINCT FROM`을 쓴다

`_assert_material_scope`는 "자료 identity는 스코프를 옮길 수 없다"(CONTRACT §1)를 지키는
가드인데, 기존 `lesson_id <> :lesson_id`는 **NULL이 끼는 순간 조용히 꺼진다** — SQL에서
`NULL <> x`는 TRUE가 아니라 NULL이기 때문이다. 즉 lesson↔curriculum 이동이 감지되지 않고
통과한다. `IS DISTINCT FROM`으로 바꿔 NULL을 값으로 비교한다.

이 함정은 nullable로 바꾸는 변경에서만 생기므로, 양방향(lesson→curriculum, curriculum→lesson)
회귀 테스트를 실제 pgvector에 고정했다.

### 4. 삭제는 봉투의 스코프를 저장된 것과 대조한다

`EmbedDeleteJob`이 싣는 `lessonId`/`curriculumId`는 대상을 찾는 데 쓰지 않는다(ADR-0006대로
`materialId`로 self-lookup한다). 다만 값이 왔는데 저장된 것과 다르면 **양측이 서로 다른 자료를
가리키고 있다는 뜻**이므로 삭제를 거부한다. 그대로 지우면 호출자가 의도하지 않은 근거가 사라진다.

## 결과

- DLQ의 커리큘럼 잡 3건이 파싱된다(원문으로 검증). 배포 후 재발행하면 회수된다.
- 레슨 잡 경로는 동작이 바뀌지 않는다 — `scope` 없는 기존 봉투가 그대로 통과한다.
- 커리큘럼 자료가 색인되면 같은 커리큘럼의 모든 질문에서 근거로 검색된다(ADR-0007 스코프 그대로).
- 스코프 이동 가드가 NULL에서도 실제로 동작한다.

## 하지 않은 것

- 검색 랭킹·threshold 변경. 커리큘럼 자료와 레슨 자료는 같은 풀에서 같은 기준으로 경쟁한다.
- `scope` 전용 컬럼. `lesson_id IS NULL`로 충분하고, 중복 표현은 어긋날 여지만 만든다.
- Spring 쪽 변경. 발행부는 이미 완성돼 있었다.

## 참고

- [docs/ai/CONTRACT.md §9](../../ai/CONTRACT.md) — 이 문서가 수용한 제안 원문
- [ai-worker CONTRACT §9.1](../../../ai/ai-worker/CONTRACT.md) — 봉투 4종 정본
