# ADR-0086: 운영 기간은 관리 화면 기본 정보 탭에서 고치고, 유효하지 않은 기간만 저장을 미룬다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-08-06
- **관련**: Sub Ⅱ · [ADR-0075](0075-autosave-syncs-query-cache.md)(자동 저장 캐시 동기화) · [ADR-0076](0076-thumbnail-instant-save-and-lesson-cache.md)(null = 변경 안 함 계약)

## 맥락 (Context)

커리큘럼 탐색 페이지의 모든 카드가 '일정 준비 중'으로 보였다. 표시 코드와 서버는 정상이다 —
`CurriculumCard`는 `period`가 있으면 날짜를 렌더하고, `CatalogService.toCard()`는 엔티티의
`startsAt`/`endsAt`를 그대로 담으며 `CurriculumPeriod.of()`는 **둘 다 null일 때만** period를 null로 만든다.

원인은 데이터가 비어 있는 것이었고, 비는 경로가 둘이었다.

1. 생성 API(`POST /instructor/curriculums`)는 기간을 받지 않아 FE가 **생성 후 PATCH로 이어 붙인다**.
   이 PATCH가 실패하면 `periodSaved: false`로 토스트만 띄우고 초안은 그대로 만들어진다.
2. 관리 화면에 기간을 **다시 넣을 자리가 없었다**. 서버 `CurriculumResponse`는 `startsAt`/`endsAt`를
   주는데 FE 타입 `InstructorCurriculumResponse`가 두 필드를 빠뜨려, 화면이 값을 읽지도 보내지도 못했다.

그래서 한 번 놓친 기간은 영구히 비어 있었다.

## 결정 (Decision)

**운영 기간을 관리 화면 '기본 정보' 탭의 기본 정보 패널 안에서 조회·수정한다** — 제목·소개와 같은
패널, 같은 디바운스 자동 저장에 태운다. 그리고 **기간이 저장할 수 없는 상태일 때는 기간만 PATCH에서
빼고(두 값을 null로) 나머지 기본 정보는 계속 저장한다.**

저장을 미루는 조건은 생성 화면과 같은 규칙이다.

| 상태 | 판정 |
|---|---|
| 시작·종료 모두 비었음 | 정상(기간 미정) — null/null을 보내 기존 값을 건드리지 않는다 |
| 한쪽만 채웠음 | 보류 + 안내 — 카드가 "시작 – 종료" 쌍으로 읽으므로 반쪽은 뜻이 없다 |
| 종료일이 과거 | 보류 + 안내 — 생성 화면이 거절하는 값을 수정으로 넣을 수 없게 |
| 종료 ≤ 시작 | 보류 + 안내 |

## 근거 (Rationale)

- **위치**: 기간은 카탈로그 카드·상세가 제목·소개와 나란히 읽는 값이다. 별도 패널로 떼면 2열 그리드
  CSS를 손봐야 하고, 패널마다 자동 저장 배지가 따로 있어야 하는지 애매해진다.
- **부분 보류**: 저장 자체를 막으면 기간을 고치는 동안 제목·소개 수정이 조용히 사라진다. PATCH의
  `null` = "변경 안 함" 계약([ADR-0076](0076-thumbnail-instant-save-and-lesson-cache.md))이 이미 있어,
  기간만 빼고 보내는 것이 서버 계약에 그대로 맞는다. 유효해지는 순간 자동 저장 지문이 바뀌어 반영된다.
- **지문에 "보낼 값"만 넣는다**: 반쪽 입력 상태의 타이핑이 자동 저장을 부르지 않게 하려면, 지문이
  로컬 입력값이 아니라 PATCH에 실을 값이어야 한다.
- **백엔드 변경 없음**: 서버가 이미 주고 받는다. FE 타입이 필드를 빠뜨린 것이 결함이었다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| (선택) 기본 정보 패널 안 + 기간만 보류 | 기존 자동 저장 한 번에 묶임, 서버 계약과 일치 | 기간 검증 규칙이 화면에 한 번 더 살아 있음(생성 화면과 중복) |
| 별도 '운영 기간' 패널 | 생성 화면과 같은 모양, 눈에 잘 띔 | 2열 그리드 CSS 조정, 저장 배지 소속이 모호 |
| 기간이 잘못되면 저장 전체 중단 | 규칙이 단순 | 기간을 고치는 동안 제목·소개 수정이 유실 |
| 생성 시 PATCH 실패를 예외로 올림 | 기간 유실을 즉시 드러냄 | 초안은 이미 만들어져 "생성 실패"로 읽히고 같은 커리큘럼을 또 만들게 된다 |

## 영향·후속 (Consequences)

- `InstructorCurriculumResponse`에 `startsAt`/`endsAt`, `SaveCurriculumManagementRequest.info`에
  같은 두 필드가 추가됐다. HTTP 구현은 `info`를 그대로 PATCH하므로 함께 전송된다.
- **저장된 기간을 다시 비우는 것은 이 화면으로 할 수 없다.** `null`이 삭제가 아니라 무변경이라서다 —
  대표 이미지 삭제와 같은 자리([ADR-0076](0076-thumbnail-instant-save-and-lesson-cache.md)).
  기간을 없애는 계약이 생기면 `periodPatch`에서 연결한다.
- 목 서비스도 기간을 읽고 저장한다(`updateMockCurriculumPeriod`). 목이 느슨하면 "화면에선 됐는데
  실서버에서 어긋남"을 가린다.
- 하네스: **계약 테스트 불필요**(POLICY 🟢). 서버가 이미 주고받는 필드를 화면이 쓰기 시작한 것이고
  필드명·상태코드를 바꾸지 않았다. 대신 통합 테스트로 기간 왕복(조회 → 수정 → 자동 저장)과 반쪽
  입력 보류, 탐색 카드의 날짜 표시를 고정했다.
- `toIsoOrNull`을 `CurriculumFormPage`에서 `shared/lib/localDateTime.ts`로 옮기고 역변환
  `toLocalInputValue`를 더했다. **UTC로 자르지 않는다** — `toISOString().slice(0,16)`은 KST 19:00을
  10:00으로 보여 주어, 저장하지 않았는데도 기간이 바뀐 것으로 읽힌다.
