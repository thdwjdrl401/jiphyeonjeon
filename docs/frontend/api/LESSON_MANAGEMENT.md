# 레슨 생성·수정·상세·PPTX 자료 API

> 공통 규칙: [API_MAP.md](../API_MAP.md) · 폼 명세: [LESSON_FORM.md](../components/LESSON_FORM.md) · 상세 명세: [LESSON_DETAIL.md](../components/LESSON_DETAIL.md) · 공유 계약: [CONTRACT.md](../../CONTRACT.md)

## 1. 범위

레슨 초안 생성, 기본 정보 수정, PPTX 초기 복수 업로드와 이후 단일 추가·삭제, AI 준비, 게시, 레슨 상세 허브에 필요한 API를 정의한다.

### 1.1 확정 상태와 원칙

- `lessonStatus`: `DRAFT → AI_NOT_READY → READY → PUBLISHED`
- 별도 `isPublished` boolean을 사용하지 않음
- 제목만으로 `DRAFT` 생성 가능
- 초기 PPTX는 복수 선택·업로드 후 명시적으로 AI 준비 시작
- 초기 준비 이후 자료 추가·삭제는 한 파일씩 즉시 처리
- 자료 추가는 해당 자료만 증분 임베딩, 삭제는 해당 자료 chunk·embedding만 제거
- 영향받은 AI 근거·산출물만 무효화·재생성
- 자료 작업 중과 `AI_NOT_READY`에서는 라이브 시작 차단
- `READY`에서 강사가 명시적으로 게시해야 `PUBLISHED`
- 라이브 중 전체 잠금, 종료 후 초기 범위에서는 제목·설명만 수정
- 영상 업로드는 없음

## 2. API 목록

### 2.1 레슨

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `LESSON-01` | `POST` | `/api/v1/instructor/sections/{sectionId}/lessons` | `DRAFT` 생성 | URL **확정** |
| `LESSON-02` | `GET` | `/api/v1/instructor/lessons/{lessonId}` | 생성·수정용 전체 상태 조회 | **제안** |
| `LESSON-03` | `PATCH` | `/api/v1/instructor/lessons/{lessonId}` | 제목·설명 수정 | URL **확정** |
| `LESSON-04` | `POST` | `/api/v1/instructor/lessons/{lessonId}/publish` | `READY → PUBLISHED` | **제안** |
| `LESSON-05` | `GET` | `/api/v1/lessons/{lessonId}` | 역할별 레슨 상세 허브 조회 | **제안** |

### 2.2 PPTX 자료

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `MATERIAL-01` | `POST` | `/api/v1/instructor/lessons/{lessonId}/materials` | PPTX 업로드 요청 생성 | URL **확정**, 상세 **협의 필요** |
| `MATERIAL-02` | `POST` | `/api/v1/instructor/lessons/{lessonId}/materials/{materialId}/complete` | 직접 업로드 완료 통지·검증 시작 | **제안** |
| `MATERIAL-03` | `POST` | `/api/v1/instructor/lessons/{lessonId}/ai-preparation` | 초기 자료 집합 AI 준비 시작 | **제안** |
| `MATERIAL-04` | `DELETE` | `/api/v1/instructor/lessons/{lessonId}/materials/{materialId}` | 활성 자료 하나 삭제·영향 처리 | **제안** |
| `MATERIAL-05` | `POST` | `/api/v1/instructor/lessons/{lessonId}/material-operations/{operationId}/retry` | 실패한 작업 재시도 | **제안** |
| `MATERIAL-06` | `GET` | `/api/v1/lessons/{lessonId}/materials/{materialId}/download` | 권한 검증 후 PPTX 다운로드 URL 발급 | **제안** |

## 3. 레슨 생성·수정 모델

### 3.1 `LESSON-01` 초안 생성

```http
POST /api/v1/instructor/sections/{sectionId}/lessons
```

```json
{
  "title": "Spring Security 시작하기",
  "description": "인증과 인가의 기본을 다룹니다."
}
```

**응답 — `201 Created`**

```json
{
  "lessonId": "les_01J...",
  "sectionId": "sec_01J...",
  "order": 3,
  "lessonStatus": "DRAFT",
  "createdAt": "2026-07-20T12:00:00+09:00",
  "allowedActions": ["EDIT_LESSON", "UPLOAD_INITIAL_MATERIALS"]
}
```

서버가 해당 섹션의 마지막 순서에 추가한다. 섹션 이동과 순서 변경은 커리큘럼 구조 API가 담당한다.

### 3.2 `LESSON-02` 강사용 편집 조회

```http
GET /api/v1/instructor/lessons/{lessonId}
```

```json
{
  "lessonId": "les_01J...",
  "title": "Spring Security 시작하기",
  "description": "인증과 인가의 기본을 다룹니다.",
  "lessonStatus": "AI_NOT_READY",
  "parent": {
    "courseId": "crs_01J...",
    "courseTitle": "실시간 Spring 입문",
    "sectionId": "sec_01J...",
    "sectionTitle": "2. 인증과 인가"
  },
  "materials": [
    {
      "materialId": "mat_01J...",
      "originalFileName": "security-basics.pptx",
      "fileSize": 3512345,
      "order": 1,
      "uploadStatus": "UPLOADED",
      "processingStatus": "EMBEDDING",
      "downloadAvailable": true
    }
  ],
  "currentMaterialOperation": {
    "operationId": "mop_01J...",
    "type": "INITIAL_PREPARATION",
    "status": "RUNNING",
    "stage": "EMBEDDING",
    "startedAt": "2026-07-20T12:03:00+09:00"
  },
  "aiReadiness": {
    "status": "PROCESSING",
    "completedMaterialCount": 1,
    "totalMaterialCount": 2,
    "failureCode": null
  },
  "liveSession": null,
  "replay": null,
  "allowedActions": ["EDIT_LESSON_INFO"]
}
```

내부 stack trace, object storage key, Vector DB 식별자는 응답하지 않는다. 실패는 공개 가능한 `failureCode`와 재시도 가능 여부로 제공한다.

### 3.3 `LESSON-03` 기본 정보 수정

```http
PATCH /api/v1/instructor/lessons/{lessonId}
```

```json
{
  "title": "Spring Security 기본",
  "description": "수정된 설명"
}
```

- 자료·AI 상태는 변경하지 않는다.
- `LIVE`이면 `409 LESSON_LOCKED_DURING_LIVE`를 반환한다.
- `ENDED`이면 제목·설명만 허용한다.
- 성공 시 수정된 기본 정보와 최신 `allowedActions`를 `200`으로 반환한다.

### 3.4 `LESSON-04` 게시

```http
POST /api/v1/instructor/lessons/{lessonId}/publish
```

요청 본문은 없다. 서버는 다음 조건을 원자적으로 다시 검증한다.

- 상태가 `READY`
- 활성 PPTX가 하나 이상
- 파싱·chunk·embedding 완료
- 진행 중 자료 작업과 필수 AI 실패 없음
- 강사 소유권 보유

```json
{
  "lessonId": "les_01J...",
  "lessonStatus": "PUBLISHED",
  "publishedAt": "2026-07-20T12:30:00+09:00",
  "allowedActions": ["VIEW_LESSON", "CREATE_LIVE_SESSION"]
}
```

조건 불충족은 `409 LESSON_NOT_READY_TO_PUBLISH`와 차단 사유 배열을 반환한다. 프론트는 낙관적으로 상태를 바꾸지 않는다.

## 4. PPTX 직접 업로드

### 4.1 공통 흐름

```text
Spring 업로드 요청 생성 → MinIO presigned URL로 직접 PUT
→ Spring에 완료 통지 → 서버 검증 → AI 작업
```

프론트는 스토리지 key를 만들지 않고, `materialId`와 발급된 URL만 사용한다. 업로드 URL은 짧은 만료 시간을 가진다.

### 4.2 `MATERIAL-01` 업로드 요청 생성

초기 준비에서는 여러 파일 metadata를 한 번에 요청하고, 이후 추가에서는 배열 길이를 1로 제한한다.

```http
POST /api/v1/instructor/lessons/{lessonId}/materials
```

```json
{
  "mode": "INITIAL",
  "files": [
    {
      "clientFileId": "local-1",
      "fileName": "security-basics.pptx",
      "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "fileSize": 3512345
    },
    {
      "clientFileId": "local-2",
      "fileName": "jwt.pptx",
      "contentType": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "fileSize": 2512345
    }
  ]
}
```

`mode`은 `INITIAL` 또는 `INCREMENTAL`이다.

```json
{
  "uploads": [
    {
      "clientFileId": "local-1",
      "materialId": "mat_01J...",
      "uploadUrl": "https://storage.example.com/...",
      "method": "PUT",
      "requiredHeaders": {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation"
      },
      "expiresAt": "2026-07-20T12:10:00+09:00"
    }
  ]
}
```

**협의할 검증**

- 파일별 최대 크기
- 확장자, MIME, magic bytes, ZIP 구조와 PPTX 손상 검증 단계
- 동일 파일 판정 기준과 중복 허용 여부
- 일부 metadata 검증 실패 시 전체 요청 실패 또는 파일별 결과 반환

### 4.3 `MATERIAL-02` 업로드 완료 통지

```http
POST /api/v1/instructor/lessons/{lessonId}/materials/{materialId}/complete
```

```json
{
  "etag": "storage-etag-if-required"
}
```

```json
{
  "materialId": "mat_01J...",
  "uploadStatus": "VALIDATING",
  "operationId": "mop_01J..."
}
```

- 초기 mode에서는 검증 완료 후 `DRAFT`의 초기 자료 집합에 포함하고 자동 AI 준비를 시작하지 않는다.
- 증분 mode에서는 검증 완료 후 해당 자료 파싱·chunk·embedding 작업을 자동 시작하고 lesson을 `AI_NOT_READY`로 전환한다.
- 같은 완료 통지는 동일 `materialId`에 대해 멱등하게 수렴해야 한다.

## 5. 초기 AI 준비

### 5.1 `MATERIAL-03`

```http
POST /api/v1/instructor/lessons/{lessonId}/ai-preparation
```

```json
{
  "materialIds": ["mat_01J...", "mat_01K..."]
}
```

**응답 — `202 Accepted`**

```json
{
  "operationId": "mop_01L...",
  "lessonId": "les_01J...",
  "lessonStatus": "AI_NOT_READY",
  "operationStatus": "QUEUED"
}
```

- 업로드·검증이 완료된 자료만 허용한다.
- 자료가 하나도 없으면 `409 MATERIAL_REQUIRED`.
- 다른 자료 작업이 진행 중이면 `409 MATERIAL_OPERATION_IN_PROGRESS`.
- 성공한 자료 상태는 작업 일부 실패 후에도 보존한다.
- 재진입 시 `LESSON-02`의 작업 상태로 복원한다.

## 6. 증분 자료 추가·삭제

### 6.1 추가

`MATERIAL-01(mode=INCREMENTAL)` → 스토리지 PUT → `MATERIAL-02` 순서로 한 파일을 추가한다.

- 한 번에 배열 길이 1
- 완료 통지 후 해당 자료만 파싱·chunk·embedding
- 기존 자료 embedding을 다시 만들지 않음
- 성공 후 영향받은 AI 후보만 생성·갱신
- 실패하면 기존 활성 자료와 기존 검색 범위를 유지
- `PUBLISHED`에서 시작하면 `AI_NOT_READY`로 전환하고 재게시 필요

### 6.2 `MATERIAL-04` 삭제

```http
DELETE /api/v1/instructor/lessons/{lessonId}/materials/{materialId}
```

```json
{
  "operationId": "mop_01M...",
  "lessonId": "les_01J...",
  "materialId": "mat_01J...",
  "lessonStatus": "AI_NOT_READY",
  "operationStatus": "QUEUED"
}
```

삭제 요청 성공은 작업 접수를 뜻하므로 `202 Accepted`를 제안한다.

- 대상 자료의 chunk·embedding 제거
- 직접 참조 근거 비활성화
- 영향을 받은 AI 결과만 `EVIDENCE_CHANGED`로 전환·재생성
- 관계없는 자료와 강사 검수 결과 유지
- 작업 실패 시 자료 상태를 복구하거나 같은 operation 재시도 제공
- 활성 자료가 마지막 하나이면 게시·라이브 조건에 미치는 영향을 확인 후 처리

여러 자료 일괄 삭제와 별도 교체 API는 제공하지 않는다.

### 6.3 `MATERIAL-05` 재시도

```http
POST /api/v1/instructor/lessons/{lessonId}/material-operations/{operationId}/retry
```

동일 작업의 실패 단계부터 재시도한다. 이미 완료·실행 중이면 최신 상태를 반환하거나 `409 MATERIAL_OPERATION_STATE_CONFLICT`를 사용한다.

## 7. 상태 모델

### 7.1 자료 업로드 상태 제안

`PENDING_UPLOAD`, `UPLOADING`, `UPLOADED`, `VALIDATING`, `VALIDATION_FAILED`, `ACTIVE`, `DELETING`, `DELETED`, `FAILED`

클라이언트가 직접 관리하는 `UPLOADING`과 서버 상태가 섞이지 않도록, 서버 enum에는 `PENDING_UPLOAD` 이후의 확인 가능한 상태만 둘지 협의한다.

### 7.2 처리 단계 제안

`QUEUED`, `VALIDATING`, `PARSING`, `CHUNKING`, `EMBEDDING`, `GENERATING_CANDIDATES`, `REMOVING_EMBEDDINGS`, `INVALIDATING_AI_RESULTS`, `COMPLETED`, `FAILED`

`stage`는 진행 안내용이며 프론트가 상태 전이를 결정하는 근거로 사용하지 않는다. 최종 `lessonStatus`, `operationStatus`, `allowedActions`를 사용한다.

### 7.3 상태 갱신

- 초기 구현은 `LESSON-02` 제한 polling 사용
- 페이지 포커스 복귀 시 재조회
- 처리 중 2~5초 간격으로 시작하고 장기 작업은 backoff
- `COMPLETED`·`FAILED`에서 polling 중단
- 추후 SSE/WS 작업 이벤트가 생기면 같은 DTO로 교체 가능

## 8. `LESSON-05` 역할별 레슨 상세

```http
GET /api/v1/lessons/{lessonId}
```

```json
{
  "lessonId": "les_01J...",
  "title": "Spring Security 시작하기",
  "description": "인증과 인가의 기본을 다룹니다.",
  "lessonStatus": "PUBLISHED",
  "parent": {
    "courseId": "crs_01J...",
    "courseTitle": "실시간 Spring 입문",
    "sectionId": "sec_01J...",
    "sectionTitle": "2. 인증과 인가"
  },
  "materials": [
    {
      "materialId": "mat_01J...",
      "originalFileName": "security-basics.pptx",
      "fileSize": 3512345,
      "order": 1,
      "downloadAvailable": true
    }
  ],
  "liveSession": {
    "sessionId": "ses_01J...",
    "scheduledAt": "2026-08-01T10:00:00+09:00",
    "entryOpensAt": "2026-08-01T09:50:00+09:00",
    "liveSessionStatus": "SCHEDULED",
    "allowedActions": ["VIEW_SESSION"]
  },
  "replay": {
    "videoAssetStatus": "READY",
    "replayStatus": "READY_FOR_REVIEW",
    "aiContentStatuses": {
      "transcript": "READY_FOR_REVIEW",
      "glossary": "PROCESSING",
      "chapters": "NOT_READY",
      "quiz": "NOT_READY"
    }
  },
  "viewerContext": {
    "relationship": "OWNER_INSTRUCTOR",
    "allowedActions": ["EDIT_LESSON", "VIEW_SESSION", "REVIEW_REPLAY"]
  },
  "previousLessonId": "les_01A...",
  "nextLessonId": "les_01K..."
}
```

- 강사는 처리 상태·복구용 요약을 추가로 받는다.
- 수강생은 `PUBLISHED` 레슨과 활성 자료만 받는다.
- 수강생에게 AI 내부 실패 상세, unpublished 후보, object storage key를 반환하지 않는다.
- HLS URL과 LiveKit token은 전용 API에서만 발급한다.

## 9. 자료 다운로드

```http
GET /api/v1/lessons/{lessonId}/materials/{materialId}/download
```

```json
{
  "downloadUrl": "https://storage.example.com/...",
  "expiresAt": "2026-07-20T12:10:00+09:00",
  "fileName": "security-basics.pptx"
}
```

서버는 요청 시마다 강사 소유권 또는 활성 수강·레슨 공개 상태를 검증한다. URL은 짧게 만료되고 다른 사용자에게 공유해도 장기 접근 수단이 되지 않아야 한다.

## 10. 공통 오류

| 상태 | 오류 코드 예시 | 의미 |
|---|---|---|
| `400` | `VALIDATION_FAILED` | 제목·설명·파일 metadata 오류 |
| `401` | `AUTH_SESSION_REQUIRED` | 로그인 필요 |
| `403` | `LESSON_MANAGE_FORBIDDEN` | 역할·소유권 없음 |
| `404` | `LESSON_NOT_FOUND`, `MATERIAL_NOT_FOUND` | 대상 없음 또는 존재 은닉 |
| `409` | `LESSON_STATE_CONFLICT` | 현재 lesson/session 상태에서 행동 불가 |
| `409` | `MATERIAL_OPERATION_IN_PROGRESS` | 다른 단일 자료 작업 진행 중 |
| `413` | `MATERIAL_FILE_TOO_LARGE` | 허용 크기 초과 |
| `415` | `MATERIAL_TYPE_NOT_SUPPORTED` | PPTX가 아님 |

## 11. 멱등성과 동시성

- 생성·업로드 요청·AI 준비·게시·삭제·재시도에는 `Idempotency-Key` header 지원을 제안한다.
- 동일 키와 동일 payload는 기존 결과로 수렴한다.
- 동일 키와 다른 payload는 `409 IDEMPOTENCY_KEY_REUSED`.
- 한 lesson에서 자료 추가·삭제 operation은 동시에 하나만 실행한다.
- 상태 충돌 응답에는 최신 `lessonStatus`, `currentMaterialOperation`, `allowedActions`를 가능한 범위에서 포함한다.

## 12. 백엔드 협의 사항

1. 제목·설명 최대 길이
2. PPTX 파일별 최대 크기와 중복 판정 기준
3. presigned 업로드 요청·완료 통지의 정확한 형태
4. 초기 복수 업로드 일부 실패 처리와 AI 준비 대상 확정 방식
5. material·operation 상태 enum과 polling 주기
6. 자료 삭제 실패 시 복구·재시도 의미
7. 게시 차단 사유 코드와 게시 취소 정책
8. `PUBLISHED` 자료 변경 후 기존 공개를 즉시 중단하는 정확한 시점
9. 종료된 레슨 자료 revision과 VOD 게시본 교체 후속 정책
10. 멱등 키 지원 범위

