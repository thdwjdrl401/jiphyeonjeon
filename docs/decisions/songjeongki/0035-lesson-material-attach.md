# ADR-0035: 자료→레슨 연결 — presigned 티켓 방식, MATERIAL 발급 허용, 레슨 단위 연결

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-26
- **관련**: [0023](0023-asset-presigned-upload.md)(presigned 업로드), [0029](0029-lesson-detail-and-display-name.md)(수강생 레슨 접근), [0026](0026-catalog-viewer-context.md)(viewerContext·materials 필드), ARCHITECTURE §9-2

## 맥락

`asset` 모듈은 presigned direct-to-storage 업로드를 구현했지만 `kind=MATERIAL`은 컨트롤러에서 400으로 막혀 있었고, `core.material_asset` 테이블·엔티티(`MaterialAsset`)는 만들어져 있으나 어디서도 참조되지 않았다(ARCHITECTURE §9-2). 그래서 레슨에 자료(PPTX)를 붙이는 경로가 없어 레슨 상세·커리큘럼 상세의 `materials`는 계약상 필드만 있고 항상 빈 목록이었고([0026]), CP3 RAG ingestion의 입력도 비어 있었다.

FE는 이미 `POST /instructor/lessons/{lessonId}/materials`로 목을 잡아 뒀다. 이 경로에 실제 연결을 배선한다.

## 결정

### 1. presigned 티켓 방식 — 본문은 assetId, multipart 아님

파일 바이트는 기존 에셋 흐름(`POST /assets/upload-requests` → presigned PUT → `POST /assets/{id}/complete`)으로 스토리지에 직접 올리고, 연결 API 본문은 그렇게 받은 `{"assetId":"..."}`만 싣는다. multipart 업로드를 새로 만들지 않는다 — 바이트가 앱 서버를 통과하지 않는 [0023]의 원칙을 자료에도 그대로 적용한다(ARCHITECTURE §9-2 지침).

경로·성공코드: `POST /api/instructor/lessons/{lessonId}/materials` → **201** `{materialId, assetId, fileName, status}`. `fileName`은 연결 시점 asset의 원본 파일명, `status`는 `MaterialStatus` 이름(연결 직후 `ACTIVE`)이다.

### 2. MATERIAL 발급 허용 — 강사만, PPTX·50MiB

`AssetController`의 kind 게이트에서 MATERIAL을 THUMBNAIL과 같은 등급으로 올린다: **강사(ROLE_INSTRUCTOR)만** 발급(학생 403), PROFILE_IMAGE는 그대로 인증만.

검증은 kind별로 분기한다. 크기 상한이 kind마다 달라 `AssetService`가 kind를 봐야 한다.

- **MATERIAL**: MIME은 PPTX(`application/vnd.openxmlformats-officedocument.presentationml.presentation`)만, 크기 상한 **50 MiB**. 발급 요청과 완료 통지(스토리지 head 재검증) 양쪽에서 같은 규칙.
- **이미지(THUMBNAIL·PROFILE_IMAGE)**: 기존대로 jpeg·png·webp, 5 MiB. 변경 없음.

상한을 상수로 분리한다(`MAX_MATERIAL_SIZE_BYTES`·`MAX_IMAGE_SIZE_BYTES`). PPTX는 CP2/CP3 RAG의 1차 입력 형식이라 지금은 여기에 한정한다 — 다른 문서 형식은 파서가 붙는 시점에 확장한다.

**신뢰 경계**: 완료 통지(`complete`) 시점의 형식 검증은 스토리지가 보고하는 `head()`의 content-type에 의존한다(magic bytes 등 실제 바이트 내용 검증은 CP3 ingestion 파서가 파일을 열 때 하게 된다). MATERIAL은 이 헤더가 없으면(`null`) **거부한다(fail closed)** — 자료는 RAG 파이프라인 입력이라 형식이 불확실한 파일을 통과시키는 쪽보다 재업로드를 요구하는 쪽이 안전하다. 이미지(THUMBNAIL·PROFILE_IMAGE)는 스토리지·클라이언트 조합에 따라 헤더 부재가 흔해 기존처럼 null을 통과시킨다(변경 없음) — 이미지는 화면 표시용이라 형식 오류의 피해가 자료보다 작다.

### 3. 연결 저장·검증은 lesson 모듈, 소유권은 curriculum

모듈 경계([AGENTS.md])대로 데이터는 lesson이 소유하고 소유권은 curriculum이 판정한다(기존 레슨 CRUD와 같은 방향).

- `lesson.api.LessonMaterialManagement` 포트: `attach(lessonId, assetId, requesterId)` → 에셋 유효성 검증 후 `material_asset`에 status=ACTIVE 저장, 레슨별·다건 조회. asset은 `asset.api.AssetDirectory`로만 참조한다(lesson→asset은 새 의존, asset은 내부 의존이 없어 순환 없음 — `ModularityTests` 통과).
- 에셋 유효성: `assetId`가 존재하고 `kind=MATERIAL`, 업로드 완료(`status=UPLOADED`), 요청자가 업로더여야 한다. 어긋나면 `MaterialAssetInvalidException` → **400** `MATERIAL_INVALID`. (업로더 검증은 [0031]/썸네일 연결과 같은 계열 — 남의 에셋을 붙이지 못하게.)
- 소유권: `curriculum`의 `requireOwnedLesson`(레슨→섹션→커리큘럼)이 먼저 돌아 비소유 강사는 **403**, 없는 레슨은 **404**(기존 레슨 엔드포인트와 동일).
- 중복(레이스 포함): 사전 조회(exists)로 대부분의 중복 요청을 즉시 막고(fast path), DB에는 부분 유니크 인덱스 `uq_material_active ON material_asset(lesson_id, asset_id) WHERE status='ACTIVE'`(V5 마이그레이션)를 최종 방어선으로 둔다 — 두 요청이 동시에 사전 조회를 통과해도 나중 저장이 제약을 맞고, `saveAndFlush`가 던지는 `DataIntegrityViolationException`을 서비스가 즉시 잡아 `MaterialAlreadyAttachedException`으로 바꾼다(둘 다 **409** `MATERIAL_ALREADY_ATTACHED`). `saveAndFlush`를 쓰는 이유는 `save()`만으론 flush가 트랜잭션 끝까지 미뤄질 수 있어 위반이 컨트롤러 밖(커밋 시점)에서야 터지기 때문이다. 부분 인덱스라 소프트 삭제(DELETING/DELETED) 후 재연결은 막지 않는다.

### 4. 읽기 채움 — 레슨/커리큘럼 상세의 materials, 노출 범위는 접근 권한과 동일

레슨 상세(`GET /api/lessons/{id}`)와 커리큘럼 상세(`GET /api/curriculums/{id}`)의 `materials`를 실제 활성(ACTIVE) 자료로 채운다. 응답 형태는 기존 `CurriculumMaterialResponse`(`{materialId, fileName, fileSize}`, FE 계약)를 그대로 쓴다.

- **레슨 상세**: `lessonDetail()`이 이미 OWNER_INSTRUCTOR·ENROLLED가 아니면 403으로 막고 반환 자체를 안 하므로 별도 게이트가 필요 없다.
- **커리큘럼 상세**: 게스트·비로그인도 호출 가능한 공개 엔드포인트라 별도 게이트가 필요하다. `viewerContext.relationship()`이 **ENROLLED 또는 OWNER_INSTRUCTOR일 때만** materials를 채우고, 그 외(GUEST·PENDING·비소유 강사)는 빈 목록이다 — `computeProgress`가 ENROLLED에만 진도를 채우는 것과 같은 게이트에 OWNER_INSTRUCTOR를 더했다(강사 자신은 자기 자료를 항상 볼 수 있어야 함). 목차(`outline`)가 이미 PUBLISHED 레슨만 담으므로(`buildOutline`) 자료도 자연히 공개 레슨 것만 노출된다 — 별도 상태 필터가 필요 없다.
- 커리큘럼 상세는 목차 레슨 id를 모아 한 번의 IN 조회로 자료를 모아 커리큘럼 단위로 평탄화한다(N+1 회피, [0033]·[0028]과 같은 배치 패턴). 자료 레코드에 딸린 에셋(파일명·크기) 해석도 `AssetDirectory.findRefs`(신설 배치 포트)로 한 번에 하고, 개별 `find()` N+1은 만들지 않는다.

### 5. 이번 범위에서 뺀 것(CP3으로 유보)

- **커리큘럼-레벨 자료**: `material_asset`은 레슨 단위(`lesson_id NOT NULL`)라 이번엔 레슨 연결만. 커리큘럼에 직접 붙는 자료는 RAG 확장과 함께.
- **자료 삭제 API**·status 전이(DELETING/DELETED): 생명주기의 나머지는 임베딩 정리 경로(CP3)와 함께.
- **AI 잡 발행**(PPTX_PARSE/EMBED outbox): 연결이 그 입력이 되지만 발행 자체는 CP3.
- FE의 `PUT /instructor/curriculums/{id}/materials`(커리큘럼 단위)는 커리큘럼-레벨 자료가 없으므로 **계속 501로 둔다** — 레슨 단위 연결만 이번에 배선했다([0030]의 미구현 API 관례).

### 6. 수강생 레슨 자료 다운로드(2026-08-05 확장)

`GET /api/lessons/{lessonId}/materials/{materialId}/download`를 학생 경로로 추가한다. Security에서
`ROLE_STUDENT`를 요구하고, 서비스는 기존 `lessonDetail()` 접근 판정을 재사용해 **ACTIVE 수강 관계**와
업로드 녹화강의의 게시 가시성을 확인한다. 판정을 통과한 뒤에도 해당 `lessonId`의 활성 자료 목록에서
`materialId`를 다시 찾아 다른 레슨 자료의 IDOR를 막는다. 성공은 기존 강사 다운로드와 같은 presigned
GET **302**, 비로그인 401·미수강/PENDING 403 `ENROLLMENT_REQUIRED`·범위 밖 자료 404다.

## 근거

- presigned 티켓은 [0023]에서 이미 검증된 경로다. 자료만 multipart로 따로 받으면 바이트가 앱을 통과해 원칙이 깨진다.
- MATERIAL 강사 한정은 THUMBNAIL과 같은 판정(자료·썸네일은 강사 저작물). 학생이 임의 파일을 스토리지에 올리는 표면을 늘리지 않는다.
- 50MiB·PPTX 한정은 CP3 RAG 파서의 1차 대상에 맞춘 최소 상한 — 값을 지어내지 않고 형식이 늘면 그때 확장한다.
- 레슨 단위만 배선한 것은 테이블 스키마(`lesson_id NOT NULL`)와 정합하고, 커리큘럼-레벨은 스키마·RAG 설계가 확정될 CP3에 함께 다루는 게 안전하다.

## 대안

| 주제 | 대안 | 기각 이유 |
|---|---|---|
| 업로드 방식 | multipart로 파일 직접 수신 | 바이트가 앱 서버를 통과 — [0023] presigned 원칙 위반, §9-2 지침과도 어긋남 |
| MATERIAL 권한 | 학생도 발급 허용 | 자료는 강사 저작물. 학생 업로드 표면을 늘릴 이유 없음(THUMBNAIL과 동일 판정) |
| 잘못된 에셋 코드 | 409(썸네일 연결처럼 상태충돌) | 자료 연결은 "잘못된 입력"이지 상태 전이 충돌이 아님 — 400이 FE 분기에 맞음 |
| 중복 방지 | 사전 조회(exists)만, DB 제약 없음 | 별도 리뷰 레인 지적대로 동시 요청 레이스를 못 잡는다(두 요청이 다 exists를 통과한 뒤 저장) — 부분 유니크 인덱스(V5)를 최종 방어선으로 채택 |
| 중복 방지 인덱스 범위 | 전체 유니크(`status` 무관) | 소프트 삭제(DELETING/DELETED) 후 같은 자료 재연결을 영구히 막아버림 — `WHERE status='ACTIVE'` 부분 인덱스로 한정 |
| materials 응답형 | 새 DTO(id/name/size/status) 신설 | 기존 `CurriculumMaterialResponse`가 FE `CurriculumMaterial` 계약과 이미 일치 — 재사용 |
| 커리큘럼 상세 materials 공개 범위 | 목차처럼 전원 공개 | 자료(PPTX)는 강의 콘텐츠 자체라 목차(제목·순서)보다 민감 — progress와 같은 ENROLLED/OWNER_INSTRUCTOR 게이트로 한정 |

## 영향·후속

- **검증**: `./gradlew test` 전체 통과(ModularityTests 포함 — lesson→asset 새 의존에 순환 없음). 갱신 `AssetUploadContractTest`(강사 MATERIAL 200·학생 403·비PPTX 400). `LessonMaterialContractTest` — 201+응답 필드명(camelCase), 비소유 403, 없는 레슨 404, 중복 409, 없는 에셋/비MATERIAL/미완료 에셋 400, 레슨 상세 materials 채움, **게스트·미수강자 커리큘럼 상세 materials 빈 목록·소유 강사는 노출**. 신규 `LessonMaterialServiceTest`(단위) — 사전 조회를 통과한 뒤 저장 시점에 `uq_material_active` 위반이 나는 레이스를 리포지토리 모킹으로 재현해, `DataIntegrityViolationException`이 500이 아니라 도메인 409로 바뀌는지 확인.
- **경계 DTO 확장**: `asset.api.AssetRef`에 `fileName`·`sizeBytes`를 추가했다(연결 응답과 materials가 파일명·크기를 실어야 함). `asset.api.AssetDirectory`에 배치 조회 `findRefs(Collection<UUID>)`를 추가해 레슨 자료 목록의 에셋 해석 N+1을 없앴다. 기존 소비자(auth·curriculum 썸네일)는 기존 메서드만 쓰므로 영향 없음.
- **스키마**: `V5__material_active_unique.sql` — `uq_material_active`(부분 유니크, `status='ACTIVE'`)로 동시 중복 연결을 DB 레벨에서 최종 차단.
- **FE**: 별도 브랜치. `POST /instructor/lessons/{lessonId}/materials`·레슨/커리큘럼 상세 `materials` 배선은 후속. FE `LessonMaterialView`(`id`/`name`/`size`)와 BE 연결 응답(`materialId`/`fileName`/`fileSize`)의 필드명 불일치는 이번 범위 밖 — FE 배선 브랜치에서 어댑터로 흡수하거나 계약을 맞춘다.
- **후속(CP3)**: 커리큘럼-레벨 자료, 자료 삭제·status 전이, AI 잡(PPTX_PARSE/EMBED) outbox 발행, `PUT /instructor/curriculums/{id}/materials` 배선, MATERIAL magic bytes 검증(ingestion 파서).
