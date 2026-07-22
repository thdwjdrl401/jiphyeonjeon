# 내 커리큘럼 API

> 공통 규칙: [API_MAP.md](../API_MAP.md) · 화면 명세: [MY_CURRICULUMS.md](../components/MY_CURRICULUMS.md) · 공유 계약: [CONTRACT.md](../../CONTRACT.md)

## 1. 범위

강사의 운영 커리큘럼 대시보드와 학생의 학습 커리큘럼 대시보드에 필요한 조회 계약을 정의한다.

- 강사는 `/instructor/curriculums`, 학생은 `/student/curriculums` 화면을 사용하며 서버 리소스도 운영과 수강으로 분리
- 대시보드 요약과 목록을 별도 요청으로 제공해 한 영역의 실패가 전체를 막지 않게 함
- 현재 사용자 역할은 `GET /auth/me`로 확인
- 목록 카드의 다음 행동은 서버가 제공한 관계·상태·허용 행동을 사용

## 2. 역할별 호출 구성

| 역할 | 요약 | 목록 |
|---|---|---|
| 강사 | `GET /api/instructor/dashboard-summary` | `GET /api/instructor/curriculums` |
| 학생 | `GET /api/me/learning-summary` | `GET /api/me/enrollments` |

프론트는 역할 확인 전 두 대시보드를 동시에 호출하지 않는다. 강사 계정의 타 커리큘럼 수강이 허용되면 `view` 전환 정책을 추가로 협의한다.

## 3. API 목록

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `MY-CURRICULUM-01` | `GET` | `/api/instructor/dashboard-summary` | 강사 운영 요약·가장 가까운 세션 | **제안** |
| `MY-CURRICULUM-02` | `GET` | `/api/instructor/curriculums` | 내가 운영하는 커리큘럼 목록 | prefix **확정**, 상세 **협의 필요** |
| `MY-CURRICULUM-03` | `GET` | `/api/me/learning-summary` | 학생 학습 요약·이어보기 | **제안** |
| `MY-CURRICULUM-04` | `GET` | `/api/me/enrollments` | 내 수강 커리큘럼 목록 | **제안** |

## 4. 강사 대시보드

### 4.1 `MY-CURRICULUM-01` 운영 요약

```http
GET /api/instructor/dashboard-summary
```

**응답 제안 — `200 OK`**

```json
{
  "curriculumCounts": {
    "total": 4,
    "preparing": 1,
    "active": 2,
    "ended": 1
  },
  "liveSessionCounts": {
    "scheduled": 2,
    "live": 0
  },
  "nextLiveSession": {
    "sessionId": "ses_01J...",
    "lessonId": "les_01J...",
    "lessonTitle": "Spring Security 시작하기",
    "curriculumId": "cur_01J...",
    "curriculumTitle": "실시간 Spring 입문",
    "scheduledAt": "2026-08-01T10:00:00+09:00",
    "liveSessionStatus": "SCHEDULED",
    "allowedActions": ["VIEW_SESSION", "EDIT_SESSION", "RUN_PREFLIGHT"]
  }
}
```

`curriculumCounts`의 UI 분류는 API 상태 그 자체가 아니다. 서버가 lifecycle 상태를 확정하기 전에는 `preparing`, `active`, `ended` 집계의 포함 기준을 문서화해야 한다.

### 4.2 `MY-CURRICULUM-02` 운영 목록

```http
GET /api/instructor/curriculums?q=spring&status=PUBLISHED&sort=TITLE_ASC&page=0&size=20
```

| Query | 형식 | 설명 |
|---|---|---|
| `q` | string | 제목 부분 검색(대소문자 무시). 생략 시 전체 |
| `status` | enum | lifecycle 상태 필터: `DRAFT` \| `PUBLISHED` \| `ARCHIVED`. 생략 시 전체 |
| `sort` | enum | `LATEST`(기본, 최근 생성 순) \| `TITLE_ASC`. `NEXT_SESSION`은 미지원 — 아래 "구현 현황" 참고 |
| `page`, `size` | integer | 공통 페이지네이션 (`page` 기본 0, `size` 기본 20 · 상한 100) |

**응답 항목 제안**

```json
{
  "items": [
    {
      "curriculumId": "cur_01J...",
      "title": "실시간 Spring 입문",
      "summary": "라이브로 배우는 Spring 기초",
      "thumbnailUrl": "https://cdn.example.com/...",
      "lifecycleStatus": "PUBLISHED",
      "sectionCount": 4,
      "lessonCount": 12,
      "publishedLessonCount": 7,
      "materialAttentionCount": 1,
      "nextLiveSession": {
        "sessionId": "ses_01J...",
        "lessonId": "les_01J...",
        "lessonTitle": "Spring Security 시작하기",
        "scheduledAt": "2026-08-01T10:00:00+09:00",
        "liveSessionStatus": "SCHEDULED"
      },
      "allowedActions": ["VIEW_DETAIL", "MANAGE_CURRICULUM", "VIEW_SESSION"]
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 4,
  "totalPages": 1,
  "hasNext": false
}
```

목록에는 수강생 개인정보나 처리 중인 AI 내부 오류를 포함하지 않는다. 관리가 필요한 자료·세션 상태는 개수와 공개 가능한 reason code 수준으로 요약한다.

#### 구현 현황 (백엔드)

- **구현됨**: `q`(제목 대소문자 무시 부분검색) · `status`(lifecycle 필터, `DRAFT`/`PUBLISHED`/`ARCHIVED`) · `sort`(`LATEST` 기본, `TITLE_ASC` — 둘 다 id 2차 키로 순서를 확정해 페이지 간 중복·누락이 없다) · `page`/`size`(공통 페이지 봉투, size 상한 100) · 소유자 본인 커리큘럼만 · `nextLiveSession`.
- **`nextLiveSession`의 의미**: "앞으로 있을 것 또는 지금 진행 중인 것" 중 가장 이른 하나. 일정 미정(`DRAFT`) · 정리 중(`ENDING`) · 종료 계열(`ENDED`/`CANCELLED`/`FAILED`)은 제외하고, `scheduledAt`이 아직 지나지 않았거나 이미 지났더라도 진행 계열(`OPEN`/`STARTING`/`LIVE`)인 세션만 대상이다. 즉 **시작하지 않은 채 방치된 과거 `SCHEDULED` 세션은 보여주지 않고**(진짜 다음 일정을 가리지 않도록), 10분 전에 시작해 방송 중인 세션은 계속 보여준다. 해당 세션이 없으면 필드 자체가 `null`.
- **미구현 — 필드 자체가 응답에 없다**(가짜 기본값을 내려 FE가 구현된 것으로 오해하지 않도록):
  - `materialAttentionCount` — `material_asset`이 아직 배선되지 않은 골격이라 계산할 값이 없다(CP2, ADR-0024).
  - `allowedActions` — `viewerContext`/허용행동 모델이 레포 전체에 미구현.
- **미구현 — 400으로 거절**: `sort=NEXT_SESSION`. 커리큘럼 × 라이브를 가로지르는 정렬이라 현재 포트로는 전역 순서를 표현할 수 없다. 페이지 내부만 재정렬하면 조용히 틀린 결과가 되므로 허용 enum에서 제외해 `VALIDATION_FAILED`(400)로 응답한다.

## 5. 학생 대시보드

### 5.1 `MY-CURRICULUM-03` 학습 요약

```http
GET /api/me/learning-summary
```

**응답 제안 — `200 OK`**

```json
{
  "enrollmentCounts": {
    "upcoming": 1,
    "inProgress": 2,
    "completed": 3
  },
  "continueLearning": {
    "curriculumId": "cur_01J...",
    "curriculumTitle": "실시간 Spring 입문",
    "lessonId": "les_01J...",
    "lessonTitle": "Spring Security 시작하기",
    "destination": "VOD",
    "sessionMs": 125000,
    "updatedAt": "2026-07-20T12:00:00+09:00"
  },
  "nextLiveSession": {
    "sessionId": "ses_01J...",
    "lessonId": "les_01K...",
    "lessonTitle": "JWT와 세션",
    "curriculumId": "cur_01J...",
    "scheduledAt": "2026-08-01T10:00:00+09:00",
    "liveSessionStatus": "SCHEDULED",
    "allowedActions": ["VIEW_SESSION"]
  }
}
```

이어보기 목적지는 서버가 재생 가능 상태를 확인해 `LESSON_DETAIL`, `LIVE_SESSION`, `LIVE_CLASSROOM`, `VOD` 중 하나로 제공한다. URL 문자열은 반환하지 않는다.

### 5.2 `MY-CURRICULUM-04` 수강 목록

```http
GET /api/me/enrollments?q=spring&learningStatus=IN_PROGRESS&sort=RECENT_LEARNING&page=0&size=20
```

| Query | 형식 | 설명 |
|---|---|---|
| `q` | string | 커리큘럼 제목·강사 표시 이름 검색 |
| `learningStatus` | enum | `UPCOMING`, `IN_PROGRESS`, `COMPLETED` 제안 |
| `sort` | enum | `RECENT_LEARNING`, `NEXT_LIVE`, `ENROLLED_AT`, `TITLE_ASC` 제안 |
| `page`, `size` | integer | 공통 페이지네이션 |

**응답 항목 제안**

```json
{
  "items": [
    {
      "enrollmentId": "enr_01J...",
      "enrollmentStatus": "ACTIVE",
      "enrolledAt": "2026-07-01T10:00:00+09:00",
      "curriculum": {
        "curriculumId": "cur_01J...",
        "title": "실시간 Spring 입문",
        "thumbnailUrl": "https://cdn.example.com/...",
        "instructor": {
          "instructorId": "usr_01K...",
          "displayName": "이강사"
        },
        "lifecycleStatus": "PUBLISHED"
      },
      "learning": {
        "learningStatus": "IN_PROGRESS",
        "completedLessonCount": 3,
        "totalLessonCount": 12,
        "progressPercent": 25,
        "lastLearning": {
          "lessonId": "les_01J...",
          "lessonTitle": "Spring Security 시작하기",
          "destination": "VOD",
          "sessionMs": 125000
        }
      },
      "nextLiveSession": null,
      "allowedActions": ["VIEW_DETAIL", "CONTINUE_LEARNING"]
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 6,
  "totalPages": 1,
  "hasNext": false
}
```

`learningStatus`와 `progressPercent`는 서버가 계산한다. 프론트가 커리큘럼 날짜나 가장 멀리 이동한 영상 시각으로 완료를 추론하지 않는다.

## 6. 상태와 오류

| 상태 | 오류 코드 예시 | 처리 |
|---|---|---|
| `200` | - | 빈 목록도 정상 응답 |
| `400` | `DASHBOARD_QUERY_INVALID` | 필터·정렬 초기화 안내 |
| `401` | `AUTH_SESSION_REQUIRED` | 로그인 후 내 커리큘럼 복귀 |
| `403` | `INSTRUCTOR_ROLE_REQUIRED` | 강사 API를 학생이 호출한 경우 접근 불가 |
| `5xx` | `DASHBOARD_UNAVAILABLE` | 요약과 목록 중 실패한 영역만 재시도 |

- 요약 실패가 목록을 막지 않는다.
- 다음 세션·최근 학습이 없으면 해당 필드를 `null`로 반환한다.
- 목록 조회 시 이미 삭제·권한 회수된 항목은 정책에 따라 제외하거나 제한 상태로 명시한다.

## 7. 백엔드 협의 사항

1. 강사 계정의 타 커리큘럼 수강 허용과 대시보드 전환 방식
2. 강사 운영 상태와 학생 학습 상태의 확정 enum·계산 기준
3. 수강 완료 판정과 커리큘럼 진행률 계산 방식
4. 요약 API와 목록 API를 분리할지 한 응답으로 합칠지
5. 다음 라이브와 최근 학습 중 대표 항목 우선순위
6. page 기반 페이지네이션 통일 여부
7. 자료·세션 주의 상태를 카드에 어느 수준까지 노출할지

