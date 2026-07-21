# 커리큘럼 상세·수강 API

> 공통 규칙: [API_MAP.md](../API_MAP.md) · 화면 명세: [CURRICULUM_DETAIL.md](../components/CURRICULUM_DETAIL.md) · 공유 계약: [CONTRACT.md](../../CONTRACT.md)

## 1. 범위

공개 커리큘럼 상세, `섹션 → 레슨` 목차, 현재 사용자 관계, 수강 신청·취소에 필요한 계약을 정의한다.

- 상세 기본 정보와 공개 목차는 비로그인 사용자에게도 제공
- 레슨 제목 공개와 레슨 콘텐츠 접근은 분리
- 관계·소유권·수강 상태와 허용 행동은 서버가 판정
- LiveKit token, HLS URL, PPTX 다운로드 URL, 전체 자막·채팅·AI 기록은 상세 응답에 포함하지 않음

## 2. 페이지 호출 구성

| 시점 | 호출 | 비고 |
|---|---|---|
| 최초 진입 | `GET /api/curriculums/{curriculumId}` | 공통 정보·목차·관계·대표 행동을 한 번에 조회 |
| 수강 신청 | `POST /api/curriculums/{curriculumId}/enrollments` | 강사 승인 대기 결과 반환 |
| 대기 신청 취소 | `DELETE /api/curriculums/{curriculumId}/enrollments/me` | 응답의 허용 행동이 있을 때만 노출 |

## 3. API 목록

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `CURRICULUM-DETAIL-01` | `GET` | `/api/curriculums/{curriculumId}` | 공개 상세·목차·관계 조회 | URL **확정**, 상세 계약 **협의 필요** |
| `ENROLLMENT-01` | `POST` | `/api/curriculums/{curriculumId}/enrollments` | 현재 사용자 수강 신청 | **제안·협의 필요** |
| `ENROLLMENT-02` | `DELETE` | `/api/curriculums/{curriculumId}/enrollments/me` | 현재 사용자 신청 취소 | **제안·정책 확정 필요** |

## 4. `CURRICULUM-DETAIL-01` 상세 조회

```http
GET /api/curriculums/{curriculumId}
```

### 4.1 응답 제안 — `200 OK`

```json
{
  "curriculumId": "cur_01J...",
  "title": "실시간 Spring 입문",
  "summary": "라이브로 배우는 Spring 기초",
  "description": "커리큘럼 상세 설명",
  "thumbnailUrl": "https://cdn.example.com/...",
  "lifecycleStatus": "PUBLISHED",
  "period": {
    "startsAt": "2026-08-01T10:00:00+09:00",
    "endsAt": "2026-09-30T22:00:00+09:00"
  },
  "enrollmentPolicy": {
    "type": "APPROVAL_REQUIRED",
    "status": "OPEN",
    "opensAt": null,
    "closesAt": null
  },
  "instructor": {
    "instructorId": "usr_01K...",
    "displayName": "이강사",
    "bio": "실시간 데이터 처리를 가르칩니다.",
    "expertise": ["Spring", "WebRTC"]
  },
  "outline": [
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
          "lessonStatus": "PUBLISHED",
          "scheduledAt": "2026-08-01T10:00:00+09:00",
          "durationMs": 5400000,
          "liveSession": {
            "sessionId": "ses_01J...",
            "liveSessionStatus": "SCHEDULED",
            "scheduledAt": "2026-08-01T10:00:00+09:00"
          },
          "replayStatus": "NOT_READY",
          "access": {
            "allowed": true,
            "destination": "LIVE_SESSION",
            "reasonCode": null
          },
          "learning": {
            "completed": false,
            "progressPercent": 35
          }
        }
      ]
    }
  ],
  "viewerContext": {
    "relationship": "ENROLLED",
    "allowedActions": ["VIEW_LESSON", "CONTINUE_LEARNING"],
    "enrollment": {
      "enrollmentId": "enr_01J...",
      "status": "ACTIVE",
      "requestedAt": "2026-07-20T12:00:00+09:00"
    },
    "progress": {
      "completedLessonCount": 3,
      "totalLessonCount": 12,
      "progressPercent": 25,
      "lastLearning": {
        "lessonId": "les_01J...",
        "sessionMs": 125000
      }
    },
    "nextLiveSession": null
  }
}
```

### 4.2 공개 기본 정보

| 영역 | 필드 | 설명 |
|---|---|---|
| 기본 | `curriculumId`, `title`, `summary`, `description`, `thumbnailUrl` | 공개 소개 |
| 상태 | `lifecycleStatus`, `period`, `enrollmentPolicy` | 공개·운영·수강 상태 |
| 강사 | `instructor` | 공개 가능한 강사 요약 |
| 목차 | `outline[].sectionId`, `title`, `description`, `order` | 공개 섹션 |
| 레슨 | `lessonId`, `title`, `order`, `lessonStatus` | 레슨 게시 상태와 공개하기로 한 최소 목차 |
| 라이브 | `liveSession.sessionId`, `liveSessionStatus`, `scheduledAt` | 연결된 라이브 세션이 없으면 `liveSession=null` |
| 다시보기 | `replayStatus` | `NOT_READY`, `DRAFT`, `READY_FOR_REVIEW`, `PUBLISHED`, `WITHDRAWN` |

비수강 사용자에게 `lessonStatus` 전체를 노출할지, `AVAILABLE|UPCOMING|LOCKED` 같은 공개용 상태로 변환할지는 **협의 필요**다. 내부 준비 상태 노출을 줄이기 위해 공개용 상태를 별도로 제공하는 방식을 제안한다.

### 4.3 관계·허용 행동

`viewerContext.relationship`은 목록 API와 동일한 enum을 사용한다.

| 관계 | 주요 `allowedActions` 예시 |
|---|---|
| `GUEST` | `LOGIN_TO_ENROLL` |
| `UNENROLLED_STUDENT` | `ENROLL` 또는 없음 |
| `PENDING_ENROLLMENT` | `CANCEL_ENROLLMENT` 또는 없음 |
| `ENROLLED` | `VIEW_LESSON`, `CONTINUE_LEARNING`, 조건부 `JOIN_LIVE` |
| `OWNER_INSTRUCTOR` | `MANAGE_CURRICULUM`, `EDIT_LESSON`, 조건부 `OPEN_LIVE_SESSION` |
| `NON_OWNER_INSTRUCTOR` | 정책에 따라 `ENROLL` 또는 없음 |

행동이 불가능한 이유를 화면에 표시해야 할 때 다음 배열을 제안한다.

```json
{
  "actionRestrictions": [
    {
      "action": "ENROLL",
      "reasonCode": "ENROLLMENT_CLOSED"
    }
  ]
}
```

프론트는 `instructorId === currentUser.userId` 같은 비교로 관리 권한을 만들지 않는다.

### 4.4 레슨 접근 요약

`outline[].lessons[].access`는 다음 화면으로 이동 가능한지를 서버가 판정한 결과다.

| 필드 | 형식 | 설명 |
|---|---|---|
| `allowed` | boolean | 현재 사용자가 레슨 관련 화면에 접근 가능한지 |
| `destination` | enum/null | `LESSON_DETAIL`, `LIVE_SESSION`, `LIVE_CLASSROOM`, `VOD` 제안 |
| `reasonCode` | string/null | `ENROLLMENT_REQUIRED`, `LESSON_NOT_PUBLISHED`, `LIVE_NOT_STARTED`, `REPLAY_NOT_PUBLISHED` 등 |

목적지 URL 자체는 서버가 반환하지 않는다. 프론트는 다음과 같이 응답 식별자와 허용된 `destination`을 실제 내부 라우트에 매핑한다.

| `destination` | 필요한 식별자 | 프론트 라우트 |
|---|---|---|
| `LESSON_DETAIL` | `curriculumId`, `sectionId`, `lessonId` | 학생은 `/student/curriculums/{curriculumId}/sections/{sectionId}/lessons/{lessonId}`, 강사는 같은 계층의 `/instructor/*` 경로 |
| `LIVE_SESSION` | `liveSession.sessionId` | 학생은 `/student/live-sessions/{sessionId}`, 강사는 `/instructor/live-sessions/{sessionId}` |
| `LIVE_CLASSROOM` | `liveSession.sessionId` | 학생은 `/student/live-sessions/{sessionId}/prejoin`을 먼저 거친 뒤 `/student/live-sessions/{sessionId}/classroom`으로 이동 |
| `VOD` | `lessonId` | 학생은 `/student/lessons/{lessonId}/replay`, 강사는 `/instructor/lessons/{lessonId}/replay` |

`LIVE_SESSION` 또는 `LIVE_CLASSROOM`인데 `liveSession.sessionId`가 누락되면 프론트는 존재하지 않는 URL을 만들지 않고 레슨 상세로 대체한다.

학생용 레슨 행은 `lessonStatus`와 활동 상태를 함께 보여준다. `OPEN|LIVE`는 강의실 직접 입장 대신 `입장 준비`를 노출하고 반드시 prejoin으로 이동한다. `DRAFT|SCHEDULED|STARTING`은 라이브 상세 확인, `replayStatus=PUBLISHED`는 다시보기 이동을 제공한다. 라이브가 `ENDING|ENDED`이고 다시보기가 아직 게시되지 않았으면 `다시보기 준비 중`을 비활성 안내로 표시한다. 연결된 라이브 일정과 게시된 다시보기가 아직 없으면 `라이브 일정 준비 중` 상태와 `레슨 자료 보기` 행동을 제공한다.

### 4.5 상태코드

| 상태 | 오류 코드 예시 | 처리 |
|---|---|---|
| `200` | - | 관계별 화면 구성 |
| `404` | `CURRICULUM_NOT_FOUND` | 찾을 수 없음. 비공개·삭제·존재하지 않음을 구분하지 않을 수 있음 |
| `5xx` | `CURRICULUM_DETAIL_UNAVAILABLE` | 현재 페이지에서 재시도 |

## 5. `ENROLLMENT-01` 수강 신청

```http
POST /api/curriculums/{curriculumId}/enrollments
```

요청 본문은 초기 범위에서 없다. 현재 세션 사용자로 신청하며 다른 사용자 ID를 받지 않는다.

### 5.1 응답 제안 — `201 Created`

```json
{
  "enrollmentId": "enr_01J...",
  "curriculumId": "cur_01J...",
  "status": "PENDING",
  "requestedAt": "2026-07-20T12:00:00+09:00",
  "approvedAt": null
}
```

현재 프론트 초기 범위는 `APPROVAL_REQUIRED`만 노출하며, 신청 결과는 항상 `PENDING`으로 시작한다. 아래의 다른 정책 값은 계약 호환과 후속 확장을 위한 값이다.

| `enrollmentPolicy.type` | 생성 결과 |
|---|---|
| `IMMEDIATE` | `status=ACTIVE` |
| `APPROVAL_REQUIRED` | `status=PENDING` |
| `INVITATION_ONLY` | 일반 신청 차단. 초대 기능은 후속 범위 |

| 상태 | 오류 코드 예시 | 의미 |
|---|---|---|
| `201` | - | 신청 생성 |
| `401` | `AUTH_SESSION_REQUIRED` | 로그인 필요 |
| `403` | `ENROLLMENT_NOT_ALLOWED_FOR_ROLE` | 계정 유형 정책상 신청 불가 |
| `404` | `CURRICULUM_NOT_FOUND` | 공개·신청 가능한 커리큘럼 없음 |
| `409` | `ENROLLMENT_ALREADY_EXISTS` | 이미 신청·수강 중 |
| `409` | `ENROLLMENT_CLOSED` | 모집 종료·정원 등 현재 상태 충돌 |

`ENROLLMENT_ALREADY_EXISTS` 응답에는 현재 enrollment 상태를 안전한 범위에서 포함하면 프론트가 최신 상태로 복구하기 쉽다.

## 6. `ENROLLMENT-02` 신청 취소

```http
DELETE /api/curriculums/{curriculumId}/enrollments/me
```

초기에는 `PENDING` 신청 취소만 허용하는 방식을 제안한다. 활성 수강 취소·권한 회수는 학습 기록 처리 정책 확정 후 별도 행동으로 다룬다.

| 상태 | 오류 코드 예시 | 의미 |
|---|---|---|
| `204` | - | 신청 취소 완료 |
| `401` | `AUTH_SESSION_REQUIRED` | 로그인 필요 |
| `404` | `ENROLLMENT_NOT_FOUND` | 현재 사용자 신청 없음 |
| `409` | `ENROLLMENT_CANNOT_BE_CANCELLED` | 이미 승인·거절·취소됨 |

## 7. 갱신과 일관성

- 신청·취소 성공 후 상세 응답 전체를 다시 조회해 `viewerContext`와 목차 행동을 갱신한다.
- 프론트는 `PENDING → ACTIVE`를 예정 시간이나 로컬 상태만으로 변경하지 않는다.
- 승인 방식이 도입되면 상세 페이지 포커스 복귀 또는 제한적 polling으로 최신 신청 상태를 확인할 수 있다.
- 강사의 운영 상태 변경과 수강 승인으로 `allowedActions`가 바뀔 수 있으므로 변경 요청 실패 시 최신 상세를 재조회한다.

## 8. 백엔드 협의 사항

1. 강사 승인 수강의 승인·거절 알림과 재신청 제한 정책
2. 강사 계정의 타 커리큘럼 수강 허용 여부
3. 비수강 사용자에게 공개할 섹션·레슨 필드 범위
4. 내부 `lessonStatus` 대신 공개용 레슨 상태를 둘지 여부
5. 커리큘럼 lifecycle·모집 상태 enum과 날짜 기반 상태 판정 주체
6. 수강 완료 기준과 상세 진행률 계산 방식
7. `PENDING` 신청 취소 외 활성 수강 취소 제공 여부
8. 보호 리소스에 `403` 또는 `404`를 적용하는 기준

