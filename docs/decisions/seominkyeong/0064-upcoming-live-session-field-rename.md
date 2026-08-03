# ADR-0064: 대시보드 라이브 필드는 `upcomingLiveSession` — "오늘"이 아니라 "가장 이른 것"이다

> 관련 결정: [ADR-0041 강사 저작 조회와 자동저장](../songjeongki/0041-instructor-authoring-reads-and-autosave.md) ·
> [ADR-0004 라이브 세션의 커리큘럼 맥락](0004-live-session-curriculum-context.md) ·
> [공유 계약 §내 수강·대시보드](../../CONTRACT.md)

- **상태**: 채택 — FE·BE·계약 문서 함께 적용
- **일자**: 2026-08-03
- **적용 범위**: `GET /me/learning-summary`, `GET /instructor/dashboard-summary`의 라이브 세션 필드

## 한 줄 결정

필드명을 `todayLiveSession` → **`upcomingLiveSession`** 으로 바꾼다. **동작은 그대로다** —
예정/진행 세션 중 `scheduledAt`이 가장 이른 하나를 준다. 이름만 실제 의미에 맞춘다.

## 맥락

### 1. 이름이 동작과 달라서 화면이 거짓말을 했다

`/instructor/curriculums`가 오늘이 8월 3일인데 **8월 4일** 세션을 "오늘의 라이브 강의"로
표시했다. 서버 버그를 의심했지만 서버는 의도대로 동작하고 있었다.

`CatalogService.nearestLiveSession()`은 커리큘럼별 다음 세션 맵에서 `scheduledAt`이 가장 이른
하나를 고를 뿐이고 **날짜 상한이 없다**. 그 입력인 `LiveSessionDirectory.nextScheduledByCurriculum()`의
계약 주석도 이렇게 적어 두었다.

> "다음"은 **앞으로 있을 것 또는 지금 진행 중인 것**을 뜻한다. … `scheduledAt`이 가장 이른 것을 돌려준다.

즉 값을 만드는 메서드 이름(`nearestLiveSession`)은 정확했고, **그것을 담는 필드 이름만**
`todayLiveSession`이었다. FE는 필드 이름을 믿고 "오늘 예정된 라이브 강의만 표시합니다"라고 써서
사실과 다른 안내를 냈다.

### 2. 왜 동작을 "오늘만"으로 바꾸지 않았나

이름에 동작을 맞추는 선택(오늘로 필터링)도 가능했다. 그러나 오늘 일정이 없는 날 화면이 비게
되고, **"다음 강의가 언제인지"라는 정보가 사라진다.** 대시보드에서 실제로 쓸모 있는 값은
"가장 가까운 다음 라이브"이므로 동작을 남기고 이름을 고쳤다.

화면은 받은 날짜를 보고 라벨을 정한다 — 오늘이면 "오늘의 라이브 강의", 아니면
"다음 라이브 강의"에 "오늘은 예정된 강의가 없어 가장 이른 다음 강의를 보여 줍니다"를 붙인다.

### 3. Mock이 서버와 다른 규칙을 쓰고 있었다

같은 조사에서 드러난 별개 문제다. `findNextLiveLesson(curriculums, today)`는 **당일 일정만**
남기고 걸렀다. 그래서 오늘 세션이 없으면 Mock은 `null`인데 실서버는 다음 주 세션을 주었다 —
[frontend/AGENTS.md](../../../frontend/AGENTS.md)가 요구하는 "Mock과 HTTP가 같은 상태 규칙을
만족한다"를 어긴 상태였다. 당일 필터를 없애 Mock도 "가장 이른 하나"로 맞췄다.

Mock에는 서버와 남는 차이가 하나 있다: **서버는 시작하지 않은 과거 SCHEDULED 세션을 제외하지만
Mock은 제외하지 않는다.** Mock fixture의 일정이 절대 날짜라서 "지금"과 비교하면 그 날짜가 지나는
순간 Mock이 조용히 `null`이 되고 테스트가 날짜에 묶인다. Mock은 계약의 정본이 아니므로
(frontend/AGENTS.md) 시간 의존성을 만들지 않는 쪽을 택했다.

## 결정 내용

- **필드**: `todayLiveSession` → `upcomingLiveSession` (두 엔드포인트 공통)
- **타입**: `StudentLearningSummary.TodayLiveSession` → `UpcomingLiveSession`,
  `TodayLiveSessionResponse` → `UpcomingLiveSessionResponse`
- **반환 구조·값은 변경 없음**. 계산 로직(`nearestLiveSession`)도 그대로다
- `CONTRACT.md`에 **"오늘로 거르지 않는다"** 를 명시해 다음 사람이 이름을 다시 오해하지 않게 한다
- Mock의 당일 필터 제거(위 3번)

## 결과

- FE가 실제 동작에 맞는 문구를 낼 수 있다. 필드 이름을 읽고 잘못 구현할 여지가 줄었다
- **호환성**: 응답 필드명이 바뀌는 **깨는 변경**이다. 이 필드를 읽는 곳은 FE 대시보드 한 곳뿐이라
  FE·BE를 같은 변경에서 함께 바꿨다. 외부 소비자는 없다
- 계약 테스트(`InstructorAuthoringReadContractTest`)가 새 필드명으로 통과한다

## 대안과 기각 이유

| 대안 | 기각 이유 |
|---|---|
| 이름 유지, `CONTRACT.md`에만 의미 명시 | 이름이 계속 오해를 만든다. 이번 오해가 이미 화면 문구 오류로 나타났다 |
| 동작을 "오늘만"으로 변경 | 오늘 일정 없는 날 정보가 사라진다. 대시보드에서 유용한 값은 "다음 라이브"다 |
| `todayLiveSession`과 `nextLiveSession` 두 필드로 분리 | 서버가 세션 하나만 집계한다. 두 필드는 집계를 두 번 하게 만들고, 화면이 실제로 쓰는 것은 하나다 |
