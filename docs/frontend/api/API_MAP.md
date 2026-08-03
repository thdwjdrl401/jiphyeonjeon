# LiveClass AI — Frontend API Map

> 페이지 기준: [PAGES.md](../PAGES.md) · 공개 페이지: [PUBLIC_PAGES.md](../components/PUBLIC_PAGES.md) · 프로필: [PROFILE.md](../components/PROFILE.md) · 공유 계약 정본: [CONTRACT.md](../../CONTRACT.md)

## 1. 문서 목적

이 문서는 프론트엔드 화면과 사용자 행동에 필요한 API를 백엔드와 협의하기 위한 초안이다.

- 프론트엔드가 필요한 데이터·상태·오류를 페이지 기준으로 설명한다.
- 합의 전 URL, 필드, 상태코드를 백엔드의 확정 계약으로 간주하지 않는다.
- 합의가 끝난 공유 요청·응답 계약은 `docs/CONTRACT.md`에 반영해야 한다.
- 구현 편의를 위해 화면별 전용 응답을 무조건 만들지 않고 여러 화면에서 재사용할 수 있는 리소스 단위 API를 우선한다.
- 서버가 소유권·수강 관계·상태 전이·허용 행동을 최종 판정한다. 프론트엔드는 계정 유형만으로 권한을 추론하지 않는다.

### 1.1 표기

| 표기 | 의미 |
|---|---|
| **확정** | `CONTRACT.md` 또는 상위 기술 계획에서 이미 정한 항목 |
| **제안** | 프론트엔드 요구를 충족하기 위해 우선 제안하는 계약 |
| **협의 필요** | 구현 전에 FE·BE가 값이나 정책을 확정해야 하는 항목 |
| **보류** | 화면 후보는 있지만 정책 확정 전 API를 만들지 않는 항목 |

### 1.2 문서 구성

이 문서는 전체 API의 공통 계약과 인증·프로필 계약을 소유한다. 페이지 도메인별 상세는 `api/` 아래 문서로 분리한다.

| 문서 | 범위 |
|---|---|
| [CATALOG.md](CATALOG.md) | 웰컴 추천 커리큘럼·공개 목록 |
| [CURRICULUM_DETAIL.md](CURRICULUM_DETAIL.md) | 공개 상세·목차·수강 신청·관계·허용 행동 |
| [MY_CURRICULUMS.md](MY_CURRICULUMS.md) | 강사 운영·학생 학습 대시보드 |
| [CURRICULUM_MANAGEMENT.md](CURRICULUM_MANAGEMENT.md) | 커리큘럼 생성·수정·섹션·순서·수강생 관리 |
| [LESSON_MANAGEMENT.md](LESSON_MANAGEMENT.md) | 레슨 생성·수정·상세·PPTX 자료·AI 준비·게시 |
| [LIVE.md](LIVE.md) | 라이브 세션·LiveKit·WS·SSE·HLS 되감기·채팅·질문 핀 |
| [VOD_LEARNING_AI.md](VOD_LEARNING_AI.md) | VOD·진도·게시 콘텐츠·AI Q&A·퀴즈·강사 검수 |

### 1.3 용어 매핑

프론트 화면 용어와 기존 백엔드 도메인·URL 용어가 다르므로 API에서는 다음 매핑을 사용한다.

| 프론트 용어 | API·도메인 용어 | 식별자 |
|---|---|---|
| 커리큘럼 | `curriculum` | `curriculumId` |
| 섹션 | `section` | `sectionId` |
| 레슨 | `lesson` | `lessonId` |
| 라이브 세션 | `liveSession` | `sessionId` |
| 수강 | `enrollment` | `enrollmentId` |

프론트 문구·API 경로·필드 모두 커리큘럼으로 통일한다. 경로는 `curriculums`, 식별자는 `curriculumId`를 사용하며 다른 도메인 명칭을 혼용하지 않는다.

## 2. 공통 호출 계약

### 2.1 기본 규칙

| 항목 | 계약 | 상태 |
|---|---|---|
| API prefix | `/api` | **확정** |
| JSON 필드명 | `camelCase` | **확정** |
| 인증 방식 | Redis에 저장하는 HttpOnly 쿠키 세션 | **확정** |
| 프론트 요청 옵션 | 모든 인증 관련 요청에 `credentials: 'include'` 적용 | **확정** |
| 인증 헤더 | `Authorization: Bearer ...`를 사용하지 않음 | **확정** |
| 변경 요청 보호 | `POST`, `PUT`, `PATCH`, `DELETE` 요청에 CSRF 토큰 전달 | **확정** |
| 일시 표현 | UTC offset을 포함한 ISO 8601 문자열 | **제안** |
| 세션 내 시간 | 정수 millisecond | **확정** |
| 식별자 표현 | JSON과 URL에서 문자열로 취급 | **제안** |

브라우저가 관리하는 세션 쿠키와 CSRF 토큰은 응답 DTO에 복제하지 않는다. `returnTo`는 프론트 라우팅 상태이며 API 요청 필드가 아니다. 프론트는 검증된 내부 경로만 로그인 후 복귀에 사용한다.

### 2.2 성공 응답 원칙

- 단건 조회·생성·수정은 별도 `data` envelope 없이 해당 리소스를 직접 반환하는 방식을 우선 제안한다.
- 응답 본문이 필요 없는 성공은 `204 No Content`를 사용한다.
- 생성 결과를 즉시 화면이나 다음 요청에서 사용한다면 생성된 리소스의 최소 식별 정보와 현재 상태를 반환한다.
- 같은 의미의 사용자 요약 DTO는 헤더, 프로필, 페이지마다 다른 필드명으로 복제하지 않는다.
- 목록 응답의 페이지네이션 형식은 커리큘럼 목록 API를 작성할 때 하나로 확정한다.

### 2.3 오류 응답 제안

프론트는 서버의 자유 형식 `message`를 그대로 화면에 노출하지 않고, 안정적인 `code`를 기준으로 사용자 문구와 복구 행동을 선택한다.

```json
{
  "code": "AUTH_INVALID_CREDENTIALS",
  "message": "요청을 처리할 수 없습니다.",
  "fieldErrors": [
    {
      "field": "email",
      "code": "REQUIRED"
    }
  ],
  "correlationId": "01J..."
}
```

| 필드 | 형식 | 필수 | 용도 |
|---|---|---|---|
| `code` | string | 예 | 프론트 분기와 로깅에 사용하는 안정적인 오류 코드 |
| `message` | string | 예 | 민감 정보가 제거된 일반 설명. 화면 문구의 유일한 근거로 사용하지 않음 |
| `fieldErrors` | array | 아니요 | 입력 필드와 연결할 수 있는 검증 오류 목록 |
| `fieldErrors[].field` | string | 예 | 요청 DTO의 camelCase 필드명 |
| `fieldErrors[].code` | string | 예 | `REQUIRED`, `INVALID_FORMAT`, `TOO_LONG` 등의 안정적인 코드 |
| `correlationId` | string | 예 | 문의와 서버 로그 추적에 사용하는 비민감 식별자 |

오류 DTO 형식과 코드 목록은 **협의 필요**다. 합의 후 모든 REST API에 동일하게 적용한다.

### 2.4 공통 HTTP 상태코드

| 상태 | 프론트 처리 | 비고 |
|---|---|---|
| `400` | 필드 오류 또는 일반 잘못된 요청 표시 | 입력 검증에 `422`를 사용할지는 **협의 필요**. 초기 제안은 `400` 통일 |
| `401` | 세션을 인증되지 않은 상태로 정리하고 로그인으로 이동 | 안전한 내부 `returnTo` 보존 |
| `403` | 세션은 유지하고 접근 불가 안내 표시 | 역할·소유권·수강 관계 위반 |
| `404` | 찾을 수 없음 또는 현재 영역의 리소스 없음 표시 | 보호 리소스의 존재 은닉에도 사용 가능 |
| `409` | 중복·현재 상태 충돌을 해당 행동 가까이에 표시 | 회원가입 이메일 중복 포함 |
| `429` | 재시도 가능 시점 안내와 중복 요청 차단 | 로그인·중복 확인 등에 적용 가능 |
| `5xx` | 네트워크/서버 오류로 처리하고 재시도 제공 | `403`·`404`로 오인하지 않음 |

### 2.5 목록 응답

초기 제안은 0부터 시작하는 page 기반 페이지네이션이다.

```json
{
  "items": [],
  "page": 0,
  "size": 20,
  "totalElements": 0,
  "totalPages": 0,
  "hasNext": false
}
```

모든 목록에서 같은 필드명을 사용한다. cursor 방식으로 변경하기로 합의하면 일부 목록에 혼용하지 않고 적용 범위를 다시 정한다.

### 2.6 관계와 허용 행동

- 서버는 역할뿐 아니라 소유권·수강 관계·lesson·session·replay 상태를 함께 검증한다.
- 조회 응답은 현재 사용자 기준 `relationship`과 `allowedActions`를 제공한다.
- 프론트는 `allowedActions`를 UX 구성에 사용하지만 변경 요청 시 서버가 권한과 최신 상태를 다시 검증한다.
- 행동이 막힌 이유를 표시해야 하면 안정적인 `reasonCode`를 사용한다.
- 서버는 프론트 route URL을 반환하지 않고 리소스 식별자와 행동 enum만 반환한다.

제안 관계 enum은 `GUEST`, `UNENROLLED_STUDENT`, `PENDING_ENROLLMENT`, `ENROLLED`, `OWNER_INSTRUCTOR`, `NON_OWNER_INSTRUCTOR`다. 실제 적용 범위와 명칭은 백엔드 협의 후 확정한다.

### 2.7 비동기 작업과 멱등성

- PPTX·AI·LiveKit 시작·Egress 종료처럼 즉시 끝나지 않는 작업은 `202 Accepted`와 `operationId`를 반환한다.
- 프론트는 HTTP timeout을 작업 실패로 확정하지 않고 리소스 또는 operation 상태를 재조회한다.
- 생성·시작·종료·자료 삭제처럼 중복 영향이 큰 요청에는 `Idempotency-Key` 지원을 제안한다.
- 상태 충돌 `409`에는 가능한 범위에서 최신 상태와 다시 허용된 행동을 포함한다.

## 3. 인증·프로필 API 목록

| ID | Method | Path | 사용처 | 상태 |
|---|---|---|---|---|
| `AUTH-01` | `GET` | `/api/auth/csrf` | 변경 요청 전 CSRF 준비 | **구현됨** |
| `AUTH-02` | `GET` | `/api/auth/email-availability` | 회원가입 이메일 중복 확인 | **구현됨** (`?email=`) |
| `AUTH-03` | `POST` | `/api/auth/signup` | 회원가입 | **구현됨** (식별자 `email`) |
| `AUTH-04` | `POST` | `/api/auth/login` | 로그인 | **구현됨** (식별자 `email`) |
| `AUTH-05` | `GET` | `/api/auth/me` | 앱 시작·새로고침 시 현재 사용자 복원 | **구현됨** |
| `AUTH-06` | `POST` | `/api/auth/logout` | 로그아웃 | **구현됨** |
| `PROFILE-IMG-01` | `PUT` | `/api/me/profile-image` | 프로필 이미지 지정(`{assetId}`) | **구현됨**. 결과는 `/auth/me`의 `profileImageUrl`로 반영 |
| `PROFILE-01` | `GET` | `/api/users/me/profile` | 내 프로필 조회 | **미구현(제안)** — 현재 백엔드 없음 |
| `PROFILE-02` | `PATCH` | `/api/users/me/profile` | 공통 프로필 수정(`displayName`) | **미구현(제안)** — 현재 백엔드 없음 |
| `PROFILE-03` | `PATCH` | `/api/instructor/me/public-profile` | 강사 공개 프로필 수정(`bio`/`expertise`) | **미구현(제안)** — 현재 백엔드 없음 |

인증 식별자는 **`email`**이다(`loginId` 아님). `AUTH-05`는 전역 헤더와 라우트 가드가 사용하는 최소 인증 사용자 API이며 `userId`·`email`·`displayName`·`role`·`profileImageUrl`을 반환한다. `PROFILE-01`은 프로필 페이지가 사용하는 상세 API 제안이지만 아직 백엔드가 없다. 두 응답의 공통 사용자 필드는 같은 명칭과 enum을 사용한다. 프로필 이미지 지정만 실제 구현되어 있고(`PROFILE-IMG-01`), `displayName`·`bio`·`expertise` 수정 API는 아직 없다.

## 4. 인증 API

### 4.1 `AUTH-01` CSRF 토큰 준비

```http
GET /api/auth/csrf
```

로그인·회원가입을 포함한 변경 요청 전에 프론트가 CSRF 토큰을 얻기 위해 필요하다. 인증 전에도 호출할 수 있어야 한다.

**제안 응답 — `200 OK`**

```json
{
  "token": "csrf-token-value",
  "headerName": "X-CSRF-TOKEN"
}
```

| 필드 | 형식 | 설명 |
|---|---|---|
| `token` | string | 다음 변경 요청에서 전달할 CSRF 토큰 |
| `headerName` | string | 토큰을 전달할 HTTP header 이름 |

**협의 필요**

- 토큰을 JSON으로 반환할지, 프론트가 읽을 수 있는 별도 쿠키로 발급할지
- 고정 header 이름을 계약으로 둘지 `headerName`을 응답할지
- 세션 만료·로그인·로그아웃 뒤 토큰을 다시 발급해야 하는 시점

### 4.2 `AUTH-02` 이메일 사용 가능 여부 (구현됨)

```http
GET /api/auth/email-availability?email=student@liveclass.test
```

인증 식별자는 `email`이다. 회원가입 폼의 중복 확인 상태에 사용한다. 이 API의 결과는 안내용이며, 회원가입 시 서버가 중복을 다시 검증한다.

**응답 — `200 OK`**

```json
{
  "email": "student@liveclass.test",
  "available": true
}
```

| 필드 | 형식 | 설명 |
|---|---|---|
| `email` | string | 정규화 후 확인한 로그인 이메일 |
| `available` | boolean | 현재 가입에 사용할 수 있는지 여부 |

| 상태 | 오류 코드 예시 | 조건 |
|---|---|---|
| `400` | `AUTH_EMAIL_INVALID` | 형식·길이가 유효하지 않음 |
| `429` | `AUTH_RATE_LIMITED` | 과도한 반복 조회 |

rate limit 기준은 **협의 필요**다.

### 4.3 `AUTH-03` 회원가입

```http
POST /api/auth/signup
```

**제안 요청**

```json
{
  "email": "student@liveclass.test",
  "password": "user-entered-password",
  "displayName": "김라이브",
  "role": "STUDENT"
}
```

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `email` | string | 예 | 로그인 식별자(이메일). 변경 불가 |
| `password` | string | 예 | 비밀번호. 응답·로그·분석 이벤트에 포함하지 않음 |
| `displayName` | string | 예 | 서비스에 표시할 사용자 이름 |
| `role` | enum | 예 | `STUDENT` 또는 `INSTRUCTOR` |

운영자 계정은 공개 회원가입으로 생성하지 않는다. 강사·학생 전용 가입 필드는 현재 확정되지 않았으므로 요청에 추가하지 않는다.

**제안 응답 — `201 Created`**

```json
{
  "userId": "usr_01J...",
  "email": "student@liveclass.test",
  "displayName": "김라이브",
  "role": "STUDENT"
}
```

| 상태 | 오류 코드 예시 | 프론트 처리 |
|---|---|---|
| `201` | - | 가입 완료 후 로그인으로 이동 |
| `400` | `VALIDATION_FAILED` | 필드별 오류 표시 |
| `409` | `AUTH_EMAIL_DUPLICATED` | 이메일 필드에 중복 오류 표시 |
| `429` | `AUTH_RATE_LIMITED` | 잠시 후 재시도 안내 |

초기 제안은 **회원가입 후 자동 로그인하지 않는 방식**이다. 가입 응답은 세션을 만들지 않고, 사용자가 로그인 화면을 거쳐 인증한다. 자동 로그인으로 결정하면 쿠키 발급 여부와 완료 후 역할별 이동 규칙을 함께 변경해야 한다.

### 4.4 `AUTH-04` 로그인

```http
POST /api/auth/login
```

**제안 요청**

```json
{
  "email": "student@liveclass.test",
  "password": "user-entered-password"
}
```

**제안 응답 — `200 OK`**

```json
{
  "userId": "usr_01J...",
  "email": "student@liveclass.test",
  "displayName": "김라이브",
  "role": "STUDENT",
  "profileImageUrl": null
}
```

응답과 함께 HttpOnly 세션 쿠키를 발급한다. 프론트는 응답의 현재 사용자 정보를 즉시 전역 인증 상태에 반영하고, 새로고침 시에는 `AUTH-05`로 복원한다.

| 상태 | 오류 코드 예시 | 프론트 처리 |
|---|---|---|
| `200` | - | 안전한 `returnTo` 또는 역할별 기본 페이지로 이동 |
| `400` | `VALIDATION_FAILED` | 입력 형식 오류 표시 |
| `401` | `AUTH_INVALID_CREDENTIALS` | 이메일 존재 여부를 구분하지 않는 로그인 실패 문구 표시 |
| `429` | `AUTH_RATE_LIMITED` | 재시도 제한 안내 |

계정 없음과 비밀번호 불일치를 서로 다른 오류 코드나 문구로 반환하지 않는 방식을 제안한다. 식별자는 이메일이다.

### 4.5 `AUTH-05` 현재 인증 사용자

```http
GET /api/auth/me
```

앱 시작, 새로고침, 보호 라우트 진입 시 현재 쿠키 세션을 사용자 정보로 복원한다. 프로필·학습 요약처럼 전역 인증에 불필요한 데이터는 포함하지 않는다. 프로필 이미지 URL은 `profileImageUrl`로 함께 반환한다(구현됨).

**응답 — `200 OK`** (구현됨)

```json
{
  "userId": "usr_01J...",
  "email": "instructor@liveclass.test",
  "displayName": "김라이브",
  "role": "INSTRUCTOR",
  "profileImageUrl": null
}
```

| 상태 | 오류 코드 예시 | 프론트 처리 |
|---|---|---|
| `200` | - | 현재 사용자 저장 후 역할별 UI 구성 |
| `401` | `AUTH_SESSION_REQUIRED` | 비로그인 상태로 확정 |

`401`은 앱 전역 오류 알림을 띄우지 않는다. 보호 라우트였다면 로그인으로 이동하고, 공개 라우트였다면 비로그인 UI를 유지한다.

### 4.6 `AUTH-06` 로그아웃

```http
POST /api/auth/logout
```

요청 본문은 없다. 서버는 현재 세션을 Redis에서 무효화하고 세션 쿠키를 만료시킨다.

| 상태 | 프론트 처리 |
|---|---|
| `204` | 로컬 인증 상태와 사용자별 캐시를 비우고 웰컴으로 이동 |
| `5xx` | 현재 화면에서 재시도. 성공으로 가장하지 않음 |

이미 만료되거나 존재하지 않는 세션에도 `204`를 반환하는 **멱등한 로그아웃**을 제안한다. 이 경우 프론트는 네트워크 응답을 받으면 동일하게 로컬 인증 상태를 정리할 수 있다.

## 5. 내 프로필 API

> **구현 현황**: 프로필 관리에서 실제 백엔드가 있는 것은 **`PUT /api/me/profile-image {assetId}`**(프로필 이미지 지정)와 **`GET /api/auth/me`**뿐이다. 아래 `PROFILE-01/02/03`(`/api/users/me/profile`, `/api/instructor/me/public-profile`)은 **미구현(제안)**으로, `displayName`·`bio`·`expertise` 조회·수정 API는 아직 백엔드에 없다.

### 5.0 `PROFILE-IMG-01` 프로필 이미지 지정 (구현됨)

```http
PUT /api/me/profile-image
```

미리 업로드 완료한 본인 `PROFILE_IMAGE` 에셋을 프로필 이미지로 지정한다.

**요청**

```json
{
  "assetId": "ast_01J..."
}
```

**응답 — `200 OK`**: `AUTH-05`(`/auth/me`)와 동일한 사용자 DTO를 반환하며, 갱신된 이미지는 `profileImageUrl`로 노출된다.

### 5.1 조회 모델 분리 원칙

- `AUTH-05`는 전역 인증에 필요한 최소 사용자 정보만 반환한다.
- `PROFILE-01`은 내 프로필 페이지의 공통 정보와 역할별 프로필을 반환한다.
- 학생의 수강·완료·다음 라이브 요약은 프로필 리소스에 섞지 않고 추후 학습 대시보드 API를 재사용한다.
- 강사의 운영 커리큘럼 요약도 프로필 리소스에 섞지 않고 추후 내 커리큘럼 API를 재사용한다.
- 보조 요약 조회 실패가 기본 프로필 조회·수정을 막지 않도록 별도 요청으로 구성한다.

### 5.2 `PROFILE-01` 내 프로필 조회 (미구현·제안)

```http
GET /api/users/me/profile
```

URL에 사용자 ID를 받지 않고 현재 세션의 본인만 조회한다. **현재 백엔드에 없다** — 현 시점에는 `GET /api/auth/me`가 최소 사용자 정보를 제공한다.

**학생 응답 제안 — `200 OK`**

```json
{
  "userId": "usr_01J...",
  "email": "student@liveclass.test",
  "displayName": "김학생",
  "role": "STUDENT"
}
```

**강사 응답 제안 — `200 OK`**

```json
{
  "userId": "usr_01K...",
  "email": "instructor@liveclass.test",
  "displayName": "이강사",
  "role": "INSTRUCTOR",
  "publicProfile": {
    "bio": "실시간 데이터 처리를 가르칩니다.",
    "expertise": ["Spring", "WebRTC"]
  }
}
```

| 필드 | 형식 | 수정 | 설명 |
|---|---|---|---|
| `userId` | string | 불가 | 내부 사용자 식별자 |
| `email` | string | 불가 | 로그인 식별자(이메일) |
| `displayName` | string | 가능 | 서비스 표시 이름 |
| `role` | enum | 불가 | `STUDENT` 또는 `INSTRUCTOR` |
| `publicProfile` | object | 역할별 | 강사에게만 포함하는 공개 프로필 |
| `publicProfile.bio` | string | 가능 | 강사 공개 소개 |
| `publicProfile.expertise` | string[] | 가능 | 강사 전문 분야 목록 |

역할별로 의미 없는 필드는 `null`로 채우기보다 응답에서 생략하는 방식을 제안한다. `role`을 판별 필드로 사용하면 프론트가 안전하게 역할별 영역을 구성할 수 있다.

### 5.3 `PROFILE-02` 공통 프로필 수정 (미구현·제안)

```http
PATCH /api/users/me/profile
```

**현재 백엔드에 없다.** `displayName` 수정 API는 아직 준비되지 않았다.

**제안 요청**

```json
{
  "displayName": "김새이름"
}
```

초기 수정 가능 필드는 `displayName` 하나만 제안한다. `email`, `role`, 전화번호는 포함하지 않는다. 프로필 이미지는 별도 API(`PROFILE-IMG-01`)로 관리한다.

**제안 응답 — `200 OK`**

```json
{
  "userId": "usr_01J...",
  "email": "student@liveclass.test",
  "displayName": "김새이름",
  "role": "STUDENT"
}
```

| 상태 | 오류 코드 예시 | 프론트 처리 |
|---|---|---|
| `200` | - | 서버 응답으로 프로필과 전역 현재 사용자 갱신 |
| `400` | `VALIDATION_FAILED` | 입력값을 유지하고 필드 오류 표시 |
| `401` | `AUTH_SESSION_REQUIRED` | 로그인 후 프로필 복귀 |

### 5.4 `PROFILE-03` 강사 공개 프로필 수정 (미구현·제안)

```http
PATCH /api/instructor/me/public-profile
```

**현재 백엔드에 없다.** `bio`·`expertise` 수정 API는 아직 준비되지 않았다. 공통 프로필과 저장 상태를 분리하기 위해 별도 API를 제안한다. 현재 세션이 강사 계정이 아니면 서버가 거부한다.

**제안 요청**

```json
{
  "bio": "실시간 데이터 처리를 가르칩니다.",
  "expertise": ["Spring", "WebRTC"]
}
```

**제안 응답 — `200 OK`**

```json
{
  "bio": "실시간 데이터 처리를 가르칩니다.",
  "expertise": ["Spring", "WebRTC"]
}
```

| 상태 | 오류 코드 예시 | 프론트 처리 |
|---|---|---|
| `200` | - | 강사 공개 프로필 영역만 갱신 |
| `400` | `VALIDATION_FAILED` | 소개·전문 분야 필드 오류 표시 |
| `401` | `AUTH_SESSION_REQUIRED` | 로그인 후 프로필 복귀 |
| `403` | `INSTRUCTOR_ROLE_REQUIRED` | 강사 전용 기능 접근 불가 표시 |

`bio` 최대 길이, `expertise`의 최대 개수·항목 길이·자유 입력 여부는 **협의 필요**다.

## 6. 시스템 페이지와 오류 매핑

시스템 페이지를 위한 별도 API는 만들지 않는다. 실패한 원래 API의 HTTP 상태와 안정적인 오류 코드를 사용한다.

| 서버 결과 | 프론트 동작 |
|---|---|
| 공개 API의 `401` | 비로그인 UI 유지가 가능한지 API 성격에 따라 판단 |
| 보호 API의 `401` | 로그인으로 이동하고 안전한 내부 목적지 보존 |
| `403` | 세션을 유지하고 오류 코드에 맞는 접근 불가 복구 행동 표시 |
| 보호 리소스의 `404` | 존재·소유자 정보를 노출하지 않는 일반 찾을 수 없음 표시 |
| `5xx`·네트워크 오류 | 접근 불가·찾을 수 없음으로 바꾸지 않고 재시도 가능한 장애 상태 표시 |

백엔드는 오류 응답에 화면 URL이나 `returnTo`를 넣지 않는다. 복구 경로는 프론트가 현재 라우트와 허용된 내부 route 목록을 기준으로 선택한다.

## 7. 이번 범위 협의 체크리스트

백엔드와 다음 항목을 합의한 뒤 해당 행을 **확정**으로 변경한다.

1. CSRF 토큰 발급 방식, header 이름, 재발급 시점
2. ~~로그인 아이디 필드명~~ — **확정: 식별자는 `email`**(구현됨). 이메일 정규화 규칙만 협의
3. `displayName`의 길이·허용 문자·공백 정규화 규칙
4. ~~중복 확인 API 제공 여부~~ — **확정: `GET /api/auth/email-availability` 구현됨**. rate limit 기준만 협의
5. 회원가입 후 로그인 화면 이동 또는 자동 로그인 중 선택
6. 현재 사용자 API를 `/auth/me`로 둘지 `/users/me`로 둘지
7. 성공 응답의 envelope 사용 여부와 공통 오류 DTO
8. 입력 검증 실패에 `400` 또는 `422` 중 어떤 상태를 사용할지
9. 강사 공개 소개와 전문 분야의 입력 제한
10. 세션 만료 상태에서 로그아웃을 `204`로 멱등 처리할지 여부

## 8. 보류 API

다음 기능은 컴포넌트 진입점은 있지만 정책이 확정되기 전까지 API 계약을 만들지 않는다.

| 기능 | 보류 이유 |
|---|---|
| 비밀번호 변경 | 현재 비밀번호 확인과 다른 세션 종료 정책 미확정 |
| 회원 탈퇴 | 운영 커리큘럼·예정 라이브·수강·학습 데이터 처리 정책 미확정 |
| 공개 강사 프로필 조회 | 별도 공개 페이지 도입 여부 미확정 |

학생 학습 요약과 강사 운영 요약은 [내 커리큘럼 API](MY_CURRICULUMS.md)에서 정의한다.

## 9. 전체 명세 검토 순서

1. 이 문서의 공통 응답·오류·인증·프로필 계약
2. [공개 탐색](CATALOG.md)과 [커리큘럼 상세·수강](CURRICULUM_DETAIL.md)
3. [내 커리큘럼](MY_CURRICULUMS.md)
4. [커리큘럼 관리](CURRICULUM_MANAGEMENT.md)
5. [레슨·PPTX 자료 관리](LESSON_MANAGEMENT.md)
6. [라이브](LIVE.md)
7. [VOD·학습·AI·퀴즈](VOD_LEARNING_AI.md)

각 상세 문서의 마지막 `백엔드 협의 사항`을 먼저 확정한 뒤, 확정된 URL·필드·상태코드를 `CONTRACT.md`와 FE·BE 계약 테스트에 반영한다.
