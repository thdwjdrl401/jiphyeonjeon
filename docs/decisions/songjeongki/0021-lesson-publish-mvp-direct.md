# ADR-0021: 레슨 발행 = MVP 직행 DRAFT→PUBLISHED (AI 준비도 게이팅 없음)

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-21
- **관련**: [0017](0017-schema-ownership-core-ai.md), [0011](0011-ai-three-services.md), FE 계약 [docs/frontend/api/LESSON_MANAGEMENT.md](../../frontend/api/LESSON_MANAGEMENT.md)

## 맥락
- 공개 카탈로그 목차(`CatalogService.buildOutline`)는 `status='PUBLISHED'` 레슨만 노출한다(`findPublishedBySections`).
- 그런데 레슨은 항상 `DRAFT`로 생성되고, **`PUBLISHED`로 올리는 코드 경로가 아예 없었다**. 결과적으로 발행된 커리큘럼의 목차가 항상 비어 있다.
- `lesson.status` CHECK는 이미 `PUBLISHED`를 허용하고, `published_at` 컬럼과 `trg_lesson_count`(status='PUBLISHED' 집계) 트리거도 이미 존재한다 — 순수 코드 공백이다.
- FE 문서([LESSON_MANAGEMENT.md](../../frontend/api/LESSON_MANAGEMENT.md))는 발행 전제를 **READY→PUBLISHED**로 적었다. 하지만 `READY`는 AI/임베딩 파이프라인이 만들어내는 상태이고, 그 파이프라인은 CP2/CP3 전에는 존재하지 않는다. 즉 READY를 전제로 걸면 목차는 계속 비어 있게 된다.

## 결정
1. **레슨 발행은 MVP 직행 command다: `DRAFT → PUBLISHED`.** 게시취소는 대칭으로 `PUBLISHED → DRAFT`. AI 준비도(`AI_NOT_READY`/`READY`/`ai_ready_at`)를 전혀 보지 않는다.
2. **모듈 경계는 기존 CRUD와 동일.** `lesson` 모듈 포트(`LessonManagement.publish/unpublish`)는 데이터만 변경한다(`setStatus`+`setPublishedAt`). 소유권·전이 유효성(중복 발행 등)·구조버전은 `curriculum` 오케스트레이터(`InstructorCurriculumService.publishLesson/unpublishLesson`)가 책임진다. `lesson`은 `curriculum`에 의존하지 않는다(순환 금지, [0017]).
3. **전이 충돌은 409.** 이미 PUBLISHED인데 발행 / DRAFT인데 게시취소 → `CurriculumStateConflictException`(`CURRICULUM_STATE_CONFLICT`).
4. **구조버전 증가.** 발행/게시취소는 학생 노출 목차를 바꾸므로 `deleteLesson`과 동일하게 `structure_version`을 +1 한다. `published_lesson_count`는 DB 트리거가 유지하므로 앱은 건드리지 않는다.
5. **DB 마이그레이션 없음.** CHECK·컬럼·트리거가 이미 갖춰져 있어 순수 코드 변경이다.

## 근거
- 목차를 실제로 채우는 것이 이 작업의 목적이며, 존재하지 않는 AI 상태를 전제로 걸면 목적을 달성할 수 없다.
- 기존 createLesson/deleteLesson 패턴을 그대로 재사용해 모듈 경계·구조버전 규약을 깨지 않는다.

## 유보(Deferred, CP2)
- **AI 준비도 축의 분리.** `AI_NOT_READY`/`READY`/`ai_ready_at`을 발행/가시성 축과 분리해 별도 컬럼으로 두는 설계는 CP2로 유보한다 — 올바른 형태가 아직 미확정이기 때문이다:
  - 단일 boolean은 "자료 없음"/"임베딩 중"/"임베딩 실패"를 뭉갠다.
  - 커리큘럼 레벨 공용 자료가 생기면 준비도는 레슨+커리큘럼 자료에 걸친 **합성 상태**가 된다.
  - 지금 이 계약을 동결하지 않는다. 스캐폴딩(enum 값·`ai_ready_at`)은 남겨두되 로직으로 엮지 않는다.

## 영향·후속
- **FE 계약 편차(조율 필요)**: 발행 전제조건이 FE 문서의 READY→PUBLISHED와 다르다(MVP는 DRAFT→PUBLISHED 직행). FE 리드 **윤광혁**에게 공유한다. CP2에서 AI 준비도 파이프라인이 생기면 전제를 다시 조인다.
- **`InstructorLessonController`의 "범위 밖(발행 READY→PUBLISHED)" 주석을 발행에 한해 대체한다** — 발행/게시취소는 이제 존재한다. 자료(PPTX/AI) 파이프라인 부분의 "범위 밖"은 유효하다.
- **계약 테스트**: `LessonPublishContractTest`가 발행→목차 노출, 게시취소→목차 제거, 비소유자 403, 없는 레슨 404, 중복 발행 409, DRAFT 게시취소 409를 검증한다.
