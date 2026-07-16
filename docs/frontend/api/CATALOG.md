# 공개 커리큘럼 탐색 API

> 공통 규칙: [API_MAP.md](../API_MAP.md) · 화면 명세: [PUBLIC_PAGES.md](../components/PUBLIC_PAGES.md) · 공유 계약: [CONTRACT.md](../../CONTRACT.md)

## 1. 범위

웰컴 페이지의 추천 커리큘럼과 공개 커리큘럼 목록 페이지에 필요한 조회 계약을 정의한다. 프론트 용어 `커리큘럼`은 API와 도메인 모델의 `curriculum`에 대응한다.

- 비로그인 사용자도 호출 가능
- 로그인 쿠키가 있으면 카드에 현재 사용자 관계와 허용 행동을 함께 제공
- 추천 목록도 별도 DTO를 만들지 않고 공개 목록 API의 필터로 조회
- 레슨 자료, 수강생 정보, LiveKit·HLS 정보는 포함하지 않음

## 2. 페이지 호출 구성

| 페이지 | 필수 호출 | 선택 호출 |
|---|---|---|
| 웰컴 | `GET /api/curriculums?featured=true&size=...` | 학생·강사 빠른 행동의 실제 요약은 내 커리큘럼 API 사용 |
| 커리큘럼 목록 | `GET /api/curriculums` | 없음 |

추천 조회가 실패해도 웰컴의 서비스 소개와 전체 탐색 CTA는 유지한다.

## 3. API 목록

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `CATALOG-01` | `GET` | `/api/curriculums` | 공개 커리큘럼 검색·필터·정렬·페이지 조회 | URL **확정**, 상세 계약 **협의 필요** |

## 4. `CATALOG-01` 공개 목록 조회

```http
GET /api/curriculums?q=spring&featured=false&lifecycleStatus=PUBLISHED&sort=LATEST&page=0&size=20
```

### 4.1 Query parameter 제안

| 이름 | 형식 | 기본값 | 설명 |
|---|---|---|---|
| `q` | string | 없음 | 제목·짧은 소개·강사 표시 이름 검색 |
| `featured` | boolean | 없음 | `true`이면 서버 추천 기준을 만족하는 항목만 조회 |
| `lifecycleStatus` | enum | `PUBLISHED` | 공개 가능한 상태 필터. 지원 enum은 협의 필요 |
| `instructorId` | string | 없음 | 특정 강사의 공개 커리큘럼 필터 |
| `sort` | enum | `LATEST` | `LATEST`, `STARTING_SOON`, `TITLE_ASC` 제안 |
| `page` | integer | `0` | 0부터 시작하는 페이지 번호 제안 |
| `size` | integer | `20` | 페이지 크기. 최대값은 서버에서 제한 |

주제·분야 필터는 분류 체계가 확정되기 전까지 추가하지 않는다. 잘못된 enum·페이지 값은 무시하지 않고 `400`으로 응답하는 방식을 제안한다.

### 4.2 응답 제안 — `200 OK`

```json
{
  "items": [
    {
      "curriculumId": "cur_01J...",
      "title": "실시간 Spring 입문",
      "summary": "라이브로 배우는 Spring 기초",
      "thumbnailUrl": "https://cdn.example.com/...",
      "instructor": {
        "instructorId": "usr_01K...",
        "displayName": "이강사"
      },
      "lifecycleStatus": "PUBLISHED",
      "period": {
        "startsAt": "2026-08-01T10:00:00+09:00",
        "endsAt": "2026-09-30T22:00:00+09:00"
      },
      "sectionCount": 4,
      "lessonCount": 12,
      "viewerContext": {
        "relationship": "ENROLLED",
        "allowedActions": ["VIEW_DETAIL", "CONTINUE_LEARNING"],
        "progress": {
          "completedLessonCount": 3,
          "totalLessonCount": 12,
          "progressPercent": 25
        }
      }
    }
  ],
  "page": 0,
  "size": 20,
  "totalElements": 42,
  "totalPages": 3,
  "hasNext": true
}
```

### 4.3 `CurriculumCardSummary`

| 필드 | 형식 | 필수 | 설명 |
|---|---|---|---|
| `curriculumId` | string | 예 | 커리큘럼 식별자 |
| `title` | string | 예 | 제목 |
| `summary` | string | 예 | 카드용 짧은 소개 |
| `thumbnailUrl` | string/null | 예 | 표시용 이미지 URL. 프론트가 스토리지 경로를 조합하지 않음 |
| `instructor` | object | 예 | 공개 가능한 담당 강사 요약 |
| `lifecycleStatus` | enum | 예 | 서버가 판정한 공개·운영 상태 |
| `period` | object/null | 예 | 전체 진행 기간 |
| `sectionCount` | integer | 예 | 공개 가능한 섹션 수 |
| `lessonCount` | integer | 예 | 공개 가능한 레슨 수 |
| `viewerContext` | object | 예 | 현재 요청자와 커리큘럼의 관계·허용 행동 |

### 4.4 `viewerContext`

| 필드 | 형식 | 설명 |
|---|---|---|
| `relationship` | enum | `GUEST`, `UNENROLLED_STUDENT`, `PENDING_ENROLLMENT`, `ENROLLED`, `OWNER_INSTRUCTOR`, `NON_OWNER_INSTRUCTOR` 제안 |
| `allowedActions` | enum[] | `VIEW_DETAIL`, `ENROLL`, `CONTINUE_LEARNING`, `MANAGE_CURRICULUM`, `JOIN_LIVE` 중 현재 가능한 행동 |
| `progress` | object | 수강생이고 카드에 표시할 데이터가 있을 때만 포함 |
| `nextLesson` | object | 실제 카드에 다음 레슨을 표시하기로 확정할 때만 포함 |

비로그인 요청도 `viewerContext.relationship=GUEST`를 반환한다. 인증 쿠키가 잘못되었거나 만료된 공개 목록 요청을 `401`로 실패시킬지, 비로그인으로 취급할지는 **협의 필요**다. 탐색 연속성을 위해 만료 세션을 정리한 뒤 비로그인 결과를 반환하는 방식을 우선 제안한다.

## 5. 추천 커리큘럼

별도 `/featured-curriculums` API를 만들지 않고 다음처럼 같은 목록 계약을 사용한다.

```http
GET /api/curriculums?featured=true&sort=RECOMMENDED&page=0&size=6
```

- 추천 기준은 서버 정책이 소유한다.
- `featured=true` 결과가 비어 있어도 정상 `200`과 빈 `items`를 반환한다.
- 추천 이유를 표시하기로 확정하면 카드에 선택 필드 `recommendationReason`을 추가한다.
- 개인화 추천이 도입되기 전에는 사용자별 민감 정보나 학습 이력을 추천 응답에 포함하지 않는다.

## 6. 오류와 캐시

| 상태 | 오류 코드 예시 | 처리 |
|---|---|---|
| `400` | `CATALOG_QUERY_INVALID` | 잘못된 검색·필터·정렬 값을 해당 control 가까이에 표시 |
| `429` | `RATE_LIMITED` | 검색 요청 간격 조절과 재시도 안내 |
| `5xx` | `CATALOG_UNAVAILABLE` | 목록 영역 재시도. 웰컴 전체는 유지 |

- 공개 기본 정보는 캐시할 수 있지만 `viewerContext`가 포함된 응답은 사용자별 캐시 분리가 필요하다.
- 사용자 관계를 포함하는 경우 CDN public cache를 사용하지 않거나 공개 정보와 관계 정보를 별도 캐시 키로 분리해야 한다.
- 검색 입력은 debounce하되 Enter 제출과 URL query 상태를 지원한다.

## 7. 백엔드 협의 사항

1. 추천 선정 기준과 `featured`·`RECOMMENDED` 지원 여부
2. 확정 검색 대상과 필터·정렬 enum
3. `lifecycleStatus` 상태 집합과 공개 목록 노출 조건
4. 페이지네이션을 page 기반으로 통일할지 cursor 기반으로 사용할지
5. 카드 응답에 사용자별 `viewerContext`를 포함할지 별도 관계 API로 분리할지
6. 만료된 세션 쿠키가 있는 공개 요청을 비로그인으로 처리할지 `401`로 처리할지
7. 대표 이미지 URL의 만료·캐시 정책

