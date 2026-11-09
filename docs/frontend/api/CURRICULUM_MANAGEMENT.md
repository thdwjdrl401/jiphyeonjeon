# 커리큘럼 생성·수정·관리 API

> 공통 규칙: [API_MAP.md](API_MAP.md) · 폼 명세: [CURRICULUM_FORM.md](../components/CURRICULUM_FORM.md) · 관리 명세: [CURRICULUM_MANAGEMENT.md](../components/CURRICULUM_MANAGEMENT.md) · 공유 계약: [CONTRACT.md](../../CONTRACT.md)

## 1. 범위

강사가 커리큘럼 기본 정보와 대표 이미지, `섹션 → 레슨` 편성, 수강생을 관리하는 API를 정의한다. PPTX 자료 업로드는 레슨 API가 담당한다.

- 모든 요청에서 강사 역할과 해당 커리큘럼 소유권을 서버가 검증
- 기본 정보, 구조 편성, 수강생 관리를 독립 요청으로 분리
- 되돌리기 어려운 lifecycle 행동은 일반 `PATCH`와 분리
- 섹션·레슨 순서는 원자적으로 저장하고 동시 수정 충돌을 감지

## 2. API 목록

### 2.1 기본 정보·대표 이미지

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `CURRICULUM-MGMT-01` | `POST` | `/api/instructor/curriculums` | 커리큘럼 생성 | **구현됨** |
| `CURRICULUM-MGMT-02` | `GET` | `/api/instructor/curriculums/{curriculumId}` | 관리용 기본 정보·권한 조회 | **구현됨** (응답 형태는 §3 현재 상태) |
| `CURRICULUM-MGMT-03` | `PATCH` | `/api/instructor/curriculums/{curriculumId}` | 기본 정보 수정 | **구현됨** (보낸 필드만 변경) |
| `CURRICULUM-MGMT-04` | `POST` | `/api/assets/upload-requests` (`kind=THUMBNAIL`) | 대표 이미지 직접 업로드 정보 발급 | **구현됨** (공용 에셋 API. 제안 경로 `/api/instructor/curriculum-thumbnails/upload-requests`는 없음) |
| `CURRICULUM-MGMT-05` | `DELETE` | `/api/instructor/curriculums/{curriculumId}/thumbnail` | 대표 이미지 연결 해제 | **구현됨** (`204`) |
| `CURRICULUM-MGMT-06` | `POST` | `/api/instructor/curriculums/{curriculumId}/publish` | 발행(`DRAFT`에서만) | **구현됨** |
| `CURRICULUM-MGMT-07` | `POST` | `/api/instructor/curriculums/{curriculumId}/archive` | 보관(`PUBLISHED`에서만) | **구현됨** |
| `CURRICULUM-MGMT-08` | `DELETE` | `/api/instructor/curriculums/{curriculumId}` | 초안 삭제 | **구현됨** (`204`) |
| `CURRICULUM-MGMT-09` | `POST`·`DELETE`·`GET` | `/api/instructor/curriculums/{curriculumId}/materials[/{materialId}[/download]]` | 커리큘럼 자료 연결·삭제·다운로드(ADR-0042) | **구현됨** |

### 2.2 섹션·순서

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `SECTION-00` | `GET` | `/api/instructor/curriculums/{curriculumId}/sections` | 섹션 목록(배치 순서) | **구현됨** |
| `SECTION-01` | `POST` | `/api/instructor/curriculums/{curriculumId}/sections` | 섹션 생성 | **구현됨** |
| `SECTION-02` | `PATCH` | `/api/instructor/sections/{sectionId}` | 섹션 정보 수정 | **구현됨** |
| `SECTION-03` | `DELETE` | `/api/instructor/sections/{sectionId}` | 빈 섹션 삭제 | **구현됨** |
| `STRUCTURE-01` | `PUT` | `/api/instructor/curriculums/{curriculumId}/curriculum/order` | 섹션·레슨 전체 순서 원자 저장 | **구현됨** |

### 2.3 수강생

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `ENROLLEE-01` | `GET` | `/api/instructor/curriculums/{curriculumId}/enrollments` | 수강 신청·수강생 목록 | **구현됨** |
| `ENROLLEE-02` | `POST` | `/api/instructor/curriculums/{curriculumId}/enrollments/{enrollmentId}/approve` · `/reject` · `/revoke` | 신청 승인·거절·권한 회수 | **구현됨** (제안했던 단일 `PATCH`는 없음) |

## 3. 관리용 조회 모델

`CURRICULUM-MGMT-02` 응답은 관리 페이지 헤더·기본 폼·편성 목록이 사용할 데이터를 제공한다.

현재 상태: 실제 응답은 평면 구조로 `curriculumId`·`title`·`summary`·`description`·`thumbnailUrl`·`lifecycleStatus`·`enrollmentType`·`startsAt`·`endsAt`·`sectionCount`·`lessonCount`·`publishedLessonCount`·`enrolleeCount`·`structureVersion`·`materials`·`publishedAt`·`createdAt`·`updatedAt`이다. `sections`·`allowedActions`·`thumbnail` 객체는 없고, 섹션·레슨은 `GET .../sections`와 `GET /api/instructor/sections/{sectionId}/lessons`로 따로 조회한다(`CurriculumResponse`).

```json
{
  "curriculumId": "cur_01J...",
  "title": "실시간 Spring 입문",
  "summary": "라이브로 배우는 Spring 기초",
  "description": "커리큘럼 상세 설명",
  "thumbnail": {
    "assetId": "ast_01J...",
    "url": "https://cdn.example.com/..."
  },
  "period": {
    "startsAt": "2026-08-01T10:00:00+09:00",
    "endsAt": "2026-09-30T22:00:00+09:00"
  },
  "lifecycleStatus": "DRAFT",
  "enrollmentPolicy": {
    "type": "IMMEDIATE",
    "status": "NOT_OPEN"
  },
  "structureVersion": 7,
  "sections": [
    {
      "sectionId": "sec_01J...",
      "title": "1. 시작하기",
      "description": "기초 환경과 개념",
      "order": 1,
      "lessons": [
        {
          "lessonId": "les_01J...",
          "title": "오리엔테이션",
          "order": 1,
          "status": "AI_NOT_READY",
          "materialSummary": {
            "activeCount": 2,
            "operationStatus": "PROCESSING",
            "attentionRequired": false
          },
          "liveSession": null,
          "allowedActions": ["VIEW_LESSON", "EDIT_LESSON", "REORDER_LESSON"]
        }
      ],
      "allowedActions": ["EDIT_SECTION", "ADD_LESSON", "REORDER_SECTION"]
    }
  ],
  "allowedActions": ["EDIT_CURRICULUM", "ADD_SECTION", "REORDER_STRUCTURE"]
}
```

레슨의 상세 자료 목록과 AI 내부 오류는 포함하지 않는다. `materialSummary.attentionRequired=true`이면 레슨 수정 화면에서 상세 상태를 조회한다.

## 4. 기본 정보 생성·수정

### 4.1 `CURRICULUM-MGMT-01` 생성

```http
POST /api/instructor/curriculums
```

```json
{
  "title": "실시간 Spring 입문",
  "summary": "라이브로 배우는 Spring 기초",
  "description": "커리큘럼 상세 설명",
  "thumbnailAssetId": "ast_01J...",
  "startsAt": "2026-08-01T10:00:00+09:00",
  "endsAt": "2026-09-30T22:00:00+09:00"
}
```

**응답 — `201 Created`**

```json
{
  "curriculumId": "cur_01J...",
  "lifecycleStatus": "DRAFT",
  "createdAt": "2026-07-20T12:00:00+09:00"
}
```

초기에는 제목, 짧은 소개, 상세 설명, 진행 기간을 입력한다. 대표 이미지 필수 여부와 enrollment policy는 확정 후 요청 필드에 추가한다.

현재 상태: 생성 요청은 `title`(필수, 최대 200자)·`summary`(최대 500자)·`description`·`thumbnailAssetId`만 받고 `startsAt`·`endsAt`는 받지 않는다. 응답은 `201`과 `CURRICULUM-MGMT-02`와 같은 `CurriculumResponse`다. 프론트는 생성 후 `PATCH`로 기간을 저장한다(`CreateCurriculumRequest`, `httpCurriculumManagementService`).

### 4.2 `CURRICULUM-MGMT-03` 수정

```http
PATCH /api/instructor/curriculums/{curriculumId}
```

```json
{
  "title": "실시간 Spring 기본과 실전",
  "summary": "수정된 소개",
  "description": "수정된 상세 설명",
  "thumbnailAssetId": "ast_01K...",
  "startsAt": "2026-08-01T10:00:00+09:00",
  "endsAt": "2026-10-15T22:00:00+09:00"
}
```

성공 시 수정된 관리용 기본 정보를 `200`으로 반환한다. lifecycle 변경·종료·삭제는 이 요청에 섞지 않는다.

### 4.3 공통 오류

| 상태 | 오류 코드 예시 | 의미 |
|---|---|---|
| `400` | `VALIDATION_FAILED` | 길이·기간·이미지 참조 오류 |
| `401` | `AUTH_SESSION_REQUIRED` | 로그인 필요 |
| `403` | `CURRICULUM_FORBIDDEN` | 강사 역할 또는 소유권 없음 |
| `404` | `CURRICULUM_NOT_FOUND` | 관리 대상 없음 |
| `409` | `CURRICULUM_STATE_CONFLICT` | 현재 lifecycle에서 수정 불가 |

## 5. 대표 이미지 업로드

Spring이 이미지 바이트를 중계하지 않고 presigned URL로 스토리지에 직접 업로드하는 방식을 제안한다.

현재 상태: 전용 경로 없이 공용 `POST /api/assets/upload-requests`(`kind=THUMBNAIL`, `fileName`·`contentType`·`fileSize`) → 스토리지 `PUT` → `POST /api/assets/{assetId}/complete` 순서로 구현되어 있다(`AssetController`, `frontend/src/shared/api/uploadAsset.ts`).

### 5.1 업로드 요청

```http
POST /api/instructor/curriculum-thumbnails/upload-requests
```

```json
{
  "fileName": "spring-curriculum.png",
  "contentType": "image/png",
  "fileSize": 245123
}
```

```json
{
  "assetId": "ast_01J...",
  "uploadUrl": "https://storage.example.com/...",
  "method": "PUT",
  "requiredHeaders": {
    "Content-Type": "image/png"
  },
  "expiresAt": "2026-07-20T12:10:00+09:00"
}
```

프론트는 업로드 성공 후 `assetId`만 생성·수정 요청에 전달한다. 허용 형식·크기·비율과 업로드 완료 확인 방식은 협의가 필요하다.

## 6. 섹션 관리

### 6.1 생성

```http
POST /api/instructor/curriculums/{curriculumId}/sections
```

```json
{
  "title": "1. 시작하기",
  "description": "기초 환경과 개념"
}
```

서버가 마지막 순서에 추가하고 `201`로 섹션을 반환한다. 현재 응답 필드는 `sectionId`·`curriculumId`·`title`·`description`·`orderIndex`·`createdAt`·`updatedAt`이며 `structureVersion`은 없다(`SectionResponse`).

### 6.2 수정

```http
PATCH /api/instructor/sections/{sectionId}
```

```json
{
  "title": "1. 환경 준비",
  "description": "개발 환경과 핵심 개념"
}
```

순서는 이 요청으로 수정하지 않고 `STRUCTURE-01`을 사용한다.

### 6.3 삭제

```http
DELETE /api/instructor/sections/{sectionId}
```

초기에는 소속 레슨이 없는 섹션만 삭제하도록 제안한다.

| 상태 | 오류 코드 예시 | 의미 |
|---|---|---|
| `204` | - | 삭제 완료 |
| `409` | `SECTION_NOT_EMPTY` | 소속 레슨이 있어 삭제 불가 |

## 7. 구조 순서 저장

```http
PUT /api/instructor/curriculums/{curriculumId}/curriculum/order
```

섹션 순서와 각 섹션의 레슨 순서를 한 요청에서 원자적으로 저장한다.

```json
{
  "baseVersion": 7,
  "sections": [
    {
      "sectionId": "sec_01J...",
      "lessonIds": ["les_01A...", "les_01B..."]
    },
    {
      "sectionId": "sec_01K...",
      "lessonIds": ["les_01C..."]
    }
  ]
}
```

```json
{
  "structureVersion": 8,
  "sections": [
    {
      "sectionId": "sec_01J...",
      "order": 1,
      "lessons": [
        {"lessonId": "les_01A...", "order": 1},
        {"lessonId": "les_01B...", "order": 2}
      ]
    }
  ]
}
```

- 모든 section·lesson이 해당 curriculum에 속하는지 검증한다.
- 누락·중복 ID가 있으면 전체 요청을 실패시킨다.
- `baseVersion` 불일치는 `409 STRUCTURE_VERSION_CONFLICT`와 최신 version을 반환한다.
- 응답의 `order`는 0부터 시작한다(`StructureOrderResponse`).
- 프론트는 충돌 시 최신 구조를 재조회하고 사용자 변경을 다시 적용하도록 안내한다.

## 8. 수강생 관리

### 8.1 목록

```http
GET /api/instructor/curriculums/{curriculumId}/enrollments?q=김&status=PENDING&page=0&size=20
```

```json
{
  "summary": {
    "pending": 2,
    "active": 30,
    "revoked": 1
  },
  "items": [
    {
      "enrollmentId": "enr_01J...",
      "student": {
        "userId": "usr_01J...",
        "displayName": "김학생"
      },
      "status": "PENDING",
      "requestedAt": "2026-07-20T12:00:00+09:00",
      "decidedAt": null,
      "allowedTransitions": ["ACTIVE", "REJECTED"]
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 2,
  "totalPages": 1,
  "hasNext": false
}
```

검색 가능한 학생 필드와 강사에게 공개할 정보 범위는 개인정보 정책과 함께 확정한다.

현재 상태: `q` 검색은 없고 `status`·`page`·`size`만 받는다. `summary`는 `pending`·`active`·`rejected`·`revoked`·`cancelled`, 항목 `student`는 `userId`·`displayName`·`email`이며 항목에 `enrolledAt`이 있다(`InstructorEnrollmentController`, `EnrollmentRosterResponse`).

### 8.2 상태 변경

```http
PATCH /api/instructor/curriculums/{curriculumId}/enrollments/{enrollmentId}
```

```json
{
  "status": "ACTIVE"
}
```

현재 상태: 단일 `PATCH` 대신 본문 없는 `POST .../{enrollmentId}/approve`·`/reject`·`/revoke`로 구현되어 있고, 응답은 갱신된 enrollment다(`InstructorEnrollmentController`).

| 전이 | 용도 |
|---|---|
| `PENDING → ACTIVE` | 승인 |
| `PENDING → REJECTED` | 거절 |
| `ACTIVE → REVOKED` | 권한 회수(`/revoke`로 구현됨) |

상태 변경은 현재 상태를 서버가 다시 검증한다. 동시 처리된 신청은 `409 ENROLLMENT_STATE_CONFLICT`와 최신 상태를 반환한다.

## 9. lifecycle 행동 보류

공개, 모집 시작·종료, 커리큘럼 종료·삭제는 정책 확정 전 API를 만들지 않는다. 도입 시 일반 정보 수정과 분리된 command endpoint와 확인용 영향 요약을 사용한다.

현재 상태: 발행(`POST .../publish`), 보관(`POST .../archive`), 초안 삭제(`DELETE /api/instructor/curriculums/{curriculumId}`)는 command endpoint로 구현되어 있다. 모집 시작·종료 API는 없다.

## 10. 백엔드 협의 사항

1. 기본 정보 필수값·최대 길이와 진행 기간 규칙
2. 대표 이미지 형식·크기·비율·업로드 완료 확인 방식
3. 커리큘럼 lifecycle와 모집 상태·전이
4. 구조 순서의 즉시 저장 또는 명시적 저장 방식
5. `structureVersion` 기반 낙관적 동시성 적용 여부
6. 레슨이 있는 섹션 삭제와 진행된 레슨 이동·삭제 정책
7. 수강 신청 방식과 enrollment 상태 enum
8. 강사에게 공개할 수강생 정보와 검색 범위
9. 커리큘럼 종료·삭제 정책과 별도 API 도입 시점

