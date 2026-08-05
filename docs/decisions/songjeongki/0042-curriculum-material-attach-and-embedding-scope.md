# ADR-0042: 커리큘럼-레벨 자료 연결 — material_asset 스코프 확장, 임베딩 잡 scope 구분

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-29
- **관련**: [0035](0035-lesson-material-attach.md)(자료→레슨 연결 — 확장), [0036](0036-material-embedding-pipeline.md)(임베딩 파이프라인 — 잡 계약 진화), [0023](0023-asset-presigned-upload.md)(presigned 업로드), [0026](0026-catalog-viewer-context.md)(viewerContext·materials 게이트), [0041](0041-instructor-authoring-reads-and-autosave.md)(강사 저작 읽기·자동저장). FE 미구현 유보: [seominkyeong/…](.) `saveCurriculumManagement`의 `notImplemented`(코드 주석의 "ADR-0030"/"MATERIAL은 CP3")
- **오너 경계**: BE(송정기) · FE(윤광혁/서민경) · AI/Python(`/ai/`, 후속 배선)

## 맥락

[0035]는 자료(PPTX)를 **레슨**에 붙이는 경로만 열었다. FE는 커리큘럼 생성/관리 화면에 "커리큘럼 강의 자료"(모든 강의 공통) UI를 이미 갖고 있으나(`CurriculumMaterialField`·`CurriculumMaterials`), 백엔드 엔드포인트가 없어 `httpCurriculumManagementService`가 자료를 포함한 저장을 `notImplemented('PUT /instructor/curriculums/{id}/materials')`로 막고 있었다(부분 쓰기 방지 가드). 즉 커리큘럼-레벨 자료는 껍데기만 있고 저장·조회·임베딩이 전무했다.

`material_asset`(V1)은 `lesson_id NOT NULL`이라 커리큘럼 자료를 담을 수 없었고, V1 주석은 이미 "커리큘럼-레벨 자료는 CP2 RAG와 함께 확장"이라고 예고해 두었다. 또한 [0036]의 임베딩 잡 envelope(`PPTX_EMBED`)은 `lessonId`·`curriculumId`를 **둘 다 필수**로 요구한다(ai-worker `PptxEmbedJob`도 동일) — 커리큘럼 자료엔 `lessonId`가 없어 같은 계약을 그대로 쓸 수 없다.

## 결정

### 1. 데이터 모델 — 새 테이블 대신 `material_asset` 스코프 확장 (V8)

`lesson_id`를 nullable로 풀고 `curriculum_id`(→`core.curriculum` FK, ON DELETE CASCADE)를 추가한다. `CHECK ((lesson_id IS NOT NULL) <> (curriculum_id IS NOT NULL))`로 **스코프를 정확히 하나**로 강제하고, 커리큘럼 자료의 동시 중복 연결은 부분 유니크 인덱스 `uq_curriculum_material_active(curriculum_id, asset_id) WHERE status='ACTIVE'`로 막는다(레슨의 `uq_material_active`와 대칭). 조회용 `ix_material_curriculum`.

재사용이 최대인 이유: **AI 콜백은 `materialId`, 다운로드 URL 발급은 `assetId`로만 키를 잡아 스코프와 무관**하다(`AiCallbackService`·`AiMaterialUrlController` 변경 0). `MaterialView`·`embedding_status`([0036])도 스코프 중립이라 그대로 쓴다.

### 2. 엔드포인트 — 레슨 자료와 대칭

- `POST /api/instructor/curriculums/{curriculumId}/materials` → **201** `{materialId, assetId, fileName, status}`
- `DELETE .../materials/{materialId}` → **204**(소프트 삭제, 멱등)
- `GET .../materials/{materialId}/download` → **302**(presigned GET로 리다이렉트)
- 중복 **409** `MATERIAL_ALREADY_ATTACHED`, 잘못된 에셋 **400** `MATERIAL_INVALID`, 비소유 **403**·없는 커리큘럼 **404**.

소유권(`curriculum.instructorId`)은 curriculum 모듈이, 에셋 유효성 검증·연결 저장은 lesson 모듈의 새 포트 `CurriculumMaterialManagement`(구현 `CurriculumMaterialService`)가 맡는다 — `material_asset`의 소유 모듈이 lesson이라 커리큘럼 스코프 행도 같은 소유자가 관리한다(모듈 경계: curriculum→lesson.api 단방향, `ModularityTests` 통과). 강사 관리용 `GET /instructor/curriculums/{id}` 응답에 `materials`를 싣고, 공개 상세(`GET /curriculums/{id}`)에도 커리큘럼 자료를 레슨 자료 앞에 이어 노출한다(게이트는 [0035]와 동일 — ENROLLED·OWNER_INSTRUCTOR).

### 3. 임베딩 잡 scope 구분

`material.embedding.enabled`가 켜지면 커리큘럼 자료도 레슨과 동일하게 attach와 같은 트랜잭션에서 outbox에 잡을 싣는다([0036] 신뢰성). 다만 `lessonId`가 없으므로 envelope에 **`scope: "CURRICULUM"`**을 싣고 `curriculumId`만 준다. 레슨 잡은 기존 형태 그대로(`scope` 미포함 = 암묵적 `LESSON`) — extra=forbid인 워커 계약을 깨지 않기 위해 레슨 payload는 바꾸지 않는다. 삭제 잡(`EMBED_DELETE`)도 커리큘럼 스코프는 `scope`+`curriculumId`로 싣는다.

### 4. 수강생 커리큘럼 자료 다운로드(2026-08-05 확장)

`GET /api/curriculums/{curriculumId}/materials/{materialId}/download`를 학생 경로로 추가한다. 공개 카탈로그
조회의 `permitAll`보다 앞에서 `ROLE_STUDENT`를 요구하고, 서비스는 공개 상세의 viewerContext를 재사용해
관계가 **ENROLLED(ACTIVE)**인지 다시 확인한다. 승인 대기·미수강 학생은 자료 목록이나 `materialId`를
알아도 403이며, 통과 후에도 해당 커리큘럼의 활성 자료에서 ID를 다시 찾아 다른 스코프 접근을 404로
막는다. 강사 다운로드는 기존 `/api/instructor/curriculums/.../download`를 유지한다.

## 근거

- **표류 최소화**: 커리큘럼 자료도 레슨 자료와 라이프사이클·상태·콜백·다운로드가 같다. 별도 테이블·엔티티·콜백 분기를 만들면 두 벌을 영원히 나란히 유지해야 한다. 스코프 컬럼 하나로 재사용하면 콜백·URL 발급·상태 머신이 공짜로 따라온다.
- **부분 쓰기 가드 해제**: 이제 자료 연결 API가 있으므로 FE의 `notImplemented` 가드를 제거한다. 저장은 구조를 먼저 커밋한 뒤 자료를 동기화(신규 업로드·attach, 사라진 자료 삭제)한다 — 레슨 자료 저장과 같은 "구조는 일관, 자료는 개별 반영" 정책.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| (선택) material_asset에 curriculum_id 추가 + CHECK 스코프 | 콜백·URL·상태·뷰 전부 재사용, 마이그레이션 1개 | 한 테이블에 두 스코프 공존(널 컬럼) |
| 별도 `curriculum_material` 테이블 | 스키마가 스코프별로 깔끔 | 콜백/URL/뷰/상태 로직 2벌, 임베딩 배선 중복 |
| 임베딩 잡에 커리큘럼도 lessonId를 억지로 채움 | 워커 계약 무변경 | ai 스키마에 가짜 lessonId 오염 → RAG 스코프 오작동 |

## 영향·후속 (Consequences)

- **BE**: V8 마이그레이션; `MaterialAsset`에 `curriculumId`; `MaterialAssetRepository` 커리큘럼 쿼리; `CurriculumMaterialManagement`/`CurriculumMaterialService`; `InstructorCurriculumService`(attach/detach/download/list + `enqueueCurriculumEmbedJob`); `InstructorCurriculumController` 엔드포인트 + `GET`에 materials; `CatalogService` 공개 상세에 커리큘럼 자료 합류; `CurriculumResponse`에 materials.
- **FE**: `CurriculumMaterial`에 `file?`; `createCurriculum`이 선택 자료를 presigned 업로드→attach; `saveCurriculumManagement`가 `notImplemented` 제거 후 신규 attach·사라진 자료 삭제·저장 후 자료 재조회; 관리 화면 자동저장 지문에 자료(fileName:fileSize) 포함, 다운로드 링크 노출.
- **계약**: [CONTRACT §2](../../CONTRACT.md#2-rest-api-apiv1) 자료 행에 커리큘럼 엔드포인트, [§3-1](../../CONTRACT.md#3-실시간서비스-간-계약-확정-인터페이스) 잡 envelope에 `scope` 추가.
- **테스트**: BE `CurriculumMaterialContractTest`(레슨 테스트 대칭 — 201/403/404/409/400·detach 멱등·download 302·관리 GET·공개 상세 게이트), FE `partialWriteGuard.test.ts` 갱신(501 가드 제거, 자료 attach/삭제 동기화 검증).
- **후속(AI, blocker)**: ai-worker `PptxEmbedJob`은 `lessonId` 필수라 **커리큘럼 스코프 잡을 아직 소비하지 못한다**. `lessonId`를 optional화하고 `scope`를 존중하도록 진화해야 실제 임베딩이 돈다. `material.embedding.enabled`가 기본 off라 현재 배선 단계에서는 무회귀(연결·조회·삭제·다운로드는 스위치와 무관하게 동작). 이 진화는 AI 오너 몫으로 남긴다.
