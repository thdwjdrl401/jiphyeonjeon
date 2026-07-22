# ADR-0028: 강사 운영 목록(MY-CURRICULUM-02) — 페이지 봉투·파생 파인더·`nextLiveSession` 의미와 미구현 필드 처리

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-22
- **관련**: [0017](0017-schema-ownership-core-ai.md), [0024](0024-orphan-module-scaffolding.md), [0026](0026-enrollment-roster-paging-and-q-deferral.md), FE 계약 [docs/frontend/api/MY_CURRICULUMS.md](../../frontend/api/MY_CURRICULUMS.md) §4.2

## 맥락

- 계약 §4.2는 `GET /api/instructor/curriculums?q=&status=&sort=&page=&size=`를 **공통 페이지 봉투**로 정의하고, 항목마다 `sectionCount`·`lessonCount`·`publishedLessonCount`·`materialAttentionCount`·`nextLiveSession`·`allowedActions`를 둔다.
- 구현은 `List<CurriculumResponse>`를 최근순으로 통째로 내려주고 있었다. 검색·필터·페이지가 없고, FE 대시보드가 요구하는 "다음 라이브 일정"을 카드에서 얻을 수 없었다.
- 제약 세 가지가 결정을 좌우했다.
  1. `material_asset`은 [0024]가 정리한 대로 **배선되지 않은 골격**이라 `materialAttentionCount`로 셀 값이 없다(CP2).
  2. `viewerContext`/허용행동 모델은 레포 전체에 없다 → `allowedActions`를 계산할 근거가 없다.
  3. `nextLiveSession`은 curriculum이 아니라 **live 모듈 소유 데이터**다. [0017]의 모듈 경계상 curriculum이 `live_session`을 조인할 수 없다.

## 결정

1. **응답은 공통 `PageResponse` 봉투**([0026]과 같은 규칙, `size` 기본 20·상한 100, `page` clamp). 항목은 계약 필드명을 그대로 쓰는 `InstructorCurriculumListItem`.
2. **`materialAttentionCount`·`allowedActions`는 응답에 넣지 않는다 — 0이나 `[]`로 채우지 않는다.** 계산 근거가 없는 값을 형식만 맞춰 내려보내면 FE는 "구현됐고 값이 0"으로 읽는다. 필드가 아예 없으면 `undefined`로 즉시 드러난다. 계약 문서 §4.2의 "구현 현황" 블록에 각각의 사유(CP2·미구현)를 적어 둔다.
3. **`sort=NEXT_SESSION`은 근사하지 않고 400(`VALIDATION_FAILED`)으로 거절한다.** `InstructorCurriculumSort` enum에서 값을 빼 Spring MVC 변환 단계에서 떨어지게 한다.
4. **정렬은 `LATEST`(createdAt DESC)·`TITLE_ASC` 두 개, 둘 다 `id ASC` 2차 키를 붙인다.** 1차 키가 겹치는 행의 순서는 DB 자유라 페이지 간 중복·누락이 생긴다.
5. **검색·필터 조합은 Specification/동적 JPQL이 아니라 파생 파인더 4개**로 나눈다(`findByInstructorId`, `…AndLifecycleStatus`, `…AndTitleContainingIgnoreCase`, `…AndLifecycleStatusAndTitleContainingIgnoreCase`). 서비스가 `q`/`status`의 null 조합으로 분기한다.
6. **`nextLiveSession`은 live 모듈의 배치 포트로만 얻는다.** `LiveSessionDirectory.nextScheduledByCurriculum(curriculumIds)`가 페이지 전체를 한 쿼리로 처리한다. 레슨 제목도 `LessonDirectory.findTitles(lessonIds)` 배치 1회. 페이지 크기와 무관하게 쿼리 수가 고정된다(목록 1 + 썸네일 1 + 세션 1 + 레슨 제목 1).
7. **"다음"의 의미를 "앞으로 있을 것 **또는** 지금 진행 중인 것"으로 확정한다.**
   - 제외: `scheduledAt IS NULL`(DRAFT), 종료 계열 `ENDED`/`CANCELLED`/`FAILED`, 그리고 **정리 중인 `ENDING`**.
   - 포함: `scheduledAt >= now` **또는** 상태가 진행 계열(`OPEN`/`STARTING`/`LIVE`).
   - 기준 시각 `now`는 DB 함수가 아니라 **서비스에서 찍어 쿼리 파라미터로 넘긴다**.
   - 결과적으로 **시작하지 않은 채 지나가 영영 `SCHEDULED`로 남은 세션은 보여주지 않는다.**

## 근거

- **가짜 값 금지(결정 2)**: 이 프로젝트는 이미 [0026]에서 "선언해 놓고 무시하면 FE가 오해한다"는 이유로 `q`를 파라미터로 받지도 않기로 했다. 같은 원칙을 응답 필드에 적용한 것이다. `materialAttentionCount: 0`은 "관리할 자료가 없음"이라는 **틀린 사실**을 단언한다.
- **NEXT_SESSION 거절(결정 3)**: 정렬 키가 `curriculum` 행이 아니라 `live_session` 행에 있다. 지금 포트로 표현하려면 (a) curriculum이 live를 조인하거나(경계 위반), (b) 전 커리큘럼의 다음 세션을 먼저 다 모아 정렬한 뒤 페이지를 자르거나(페이징 의미 상실), (c) 페이지를 자른 뒤 그 안에서만 재정렬해야 한다. (c)는 **응답이 정렬된 것처럼 보이지만 전역 순서가 아니다** — 2페이지 첫 행이 1페이지 마지막 행보다 이를 수 있다. 조용히 틀린 결과보다 400이 낫다.
- **파생 파인더(결정 5)**: `CurriculumRepository.searchPublic` 주석이 기록한 대로, "파라미터가 null이면 조건 무시"를 한 JPQL에 넣으면 Postgres가 바인딩 타입을 추론하지 못해(`CONCAT`에 null → bytea) 깨진다. Specification은 이를 피하지만 조합이 4개뿐인 화면에 크라이테리아 API를 들이는 비용이 크고, 파생 파인더는 메서드 이름이 곧 쿼리라 리뷰가 쉽다. `TitleContainingIgnoreCase`는 와일드카드를 바인딩 값 쪽에 붙여 타입 추론 문제 자체를 피한다.
- **`now` 필터(결정 7)**: 세션에는 에셋의 `AssetReaper` 같은 **회수 배치가 없다.** 시작도 취소도 안 된 세션은 `SCHEDULED`인 채 DB에 영구히 남는다. `scheduledAt IS NOT NULL AND status NOT IN (종료 계열)`만으로 거르면 그런 행이 `ORDER BY scheduledAt ASC`의 맨 앞을 차지해 **진짜 다음 일정을 가린다.** 시간이 갈수록 나빠지는 성질이라 조회 조건에서 잘라야 한다.
- **진행 계열 예외(결정 7)**: `scheduledAt >= now`만 쓰면 10분 전에 시작해 지금 방송 중인 세션이 목록에서 사라진다. 강사 대시보드에서 가장 보고 싶은 카드가 그것이다.
- **`ENDING` 제외(결정 7)**: 종료 절차를 밟는 중인 세션을 "다음 일정"으로 보여주면 강사는 아직 시작 전이라고 읽는다. 상태 이름이 종료 계열이 아닐 뿐 의미상 끝난 세션이다.
- **`now`를 앱에서 주입(결정 7)**: DB `now()`를 쓰면 테스트가 시계를 잡을 수 없고, 한 페이지 안의 행이 서로 다른 시점을 기준으로 판정될 여지도 생긴다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| (선택) 페이지 봉투 + 파생 파인더 4개 + live 배치 포트 | 계약 일치, 경계 유지, 쿼리 수 고정 | 파인더가 4개로 늘어남(조건이 하나 더 붙으면 8개) |
| `Specification`/동적 JPQL 한 벌 | 조건이 늘어도 메서드가 안 늘어남 | null 바인딩 타입 추론 이슈, 크라이테리아 코드가 읽기 어려움, 조합 4개엔 과함 |
| `materialAttentionCount: 0`·`allowedActions: []`로 채우기 | 계약 예시와 모양이 같음 | 계산 근거 없는 값을 사실로 단언 — FE가 구현됐다고 오해 |
| `sort=NEXT_SESSION`을 페이지 내부 재정렬로 근사 | 400을 안 봄 | 전역 순서가 아님. 페이지 경계에서 뒤집힘 → 조용히 틀림 |
| `sort=NEXT_SESSION`을 무시하고 `LATEST`로 대체 | 항상 200 | 요청과 다른 정렬을 말없이 수행 — 가장 나쁜 실패 |
| `nextLiveSession`을 행마다 `findByLessonId`로 조회 | 코드가 단순 | N+1. 페이지 20이면 쿼리 20+ |
| 종료 계열만 제외(now 필터 없음) | 쿼리가 짧음 | 방치된 과거 `SCHEDULED`가 진짜 다음 일정을 영구히 가림(이 ADR이 고친 버그) |
| 방치 세션을 배치로 `CANCELLED` 회수 | 데이터가 깨끗해짐 | 정책 결정(몇 시간 후? 알림?)이 필요 — 조회 조건으로 먼저 막고 별도로 다룬다 |
| `now`를 DB 함수로 | 파라미터 하나 절약 | 테스트에서 시계 고정 불가 |

## 영향·후속

- **파괴적 변경**: `GET /api/instructor/curriculums`의 응답이 배열 → 페이지 봉투로 바뀌고, 항목 필드가 `CurriculumResponse`에서 목록 전용 `InstructorCurriculumListItem`으로 좁아졌다. FE 리드 **윤광혁**에게 공유한다.
- **스키마**: `V4__live_session_curriculum_index.sql`이 `core.live_session (curriculum_id, scheduled_at)` 인덱스를 추가한다. Postgres는 FK에 인덱스를 자동 생성하지 않는데, 이 목록이 요청마다 `curriculum_id IN (...) AND scheduled_at ...`를 돈다.
- **정리된 것**: `CurriculumRepository.findByInstructorIdOrderByCreatedAtDesc`(옛 `listMine` 파인더)는 호출자가 사라져 삭제했다.
- **계약 테스트**: `InstructorCurriculumListContractTest`가 페이지 봉투·항목 필드명, 소유권 경계, `q`·`status`·둘의 조합, `TITLE_ASC`/기본 정렬, `sort=NEXT_SESSION` 400, 범위 밖 필드 부재, `nextLiveSession`의 가장 이른 일정·일정 미정·취소·종료·**과거 미시작·과거지만 진행 중**, **커리큘럼↔세션 짝짓기**, 그리고 행 수를 늘려도 SQL 문 수가 그대로인 N+1 가드를 검증한다.
- **후속 1 — 방치된 SCHEDULED 세션에 회수 배치가 없다.** 에셋은 `AssetReaper`가 만료된 PENDING을 FAILED로 회수하지만, 라이브 세션에는 대응물이 없다. 이번 결정은 **조회에서 감출 뿐 DB에는 계속 쌓인다.** 회수 정책(예정 시각 +N시간 후 자동 CANCELLED? 강사 알림?)을 정하는 후속 작업이 필요하다.
- **후속 2 — `q`의 와일드카드 이스케이프가 없다.** `TitleContainingIgnoreCase`는 입력을 그대로 `LIKE` 패턴에 넣으므로 `%`·`_`가 사용자 입력에서 메타문자로 동작한다. 주입 위험은 없으나(바인딩 파라미터) `_`를 포함한 검색어가 의도와 다르게 넓게 매칭된다. 공개 카탈로그(`searchPublic`)도 같은 성질이라 함께 다룬다.
- **후속 3 — 세션 배치 조회에 `LIMIT`이 없다.** 커리큘럼별 첫 행만 쓰면서도 조건에 맞는 세션을 전부 읽어 애플리케이션에서 접는다. 비용이 페이지 크기가 아니라 **해당 커리큘럼들의 예정 세션 수**에 비례한다. 지금은 커리큘럼당 세션이 레슨 수 이하라 견디지만, `DISTINCT ON`(Postgres)이나 윈도우 함수로 커리큘럼당 1행만 가져오는 것이 정공법이다. 바꾸려면 JPQL을 벗어나야 해서 보류했다.
- **후속 4 — 썸네일 배치는 문 수 가드가 관측하지 못한다.** N+1 가드가 쓰는 픽스처에는 썸네일이 달린 커리큘럼이 없어 `AssetDirectory.resolveUrls`가 빈 목록으로 즉시 반환한다 — 즉 세 배치 중 썸네일 경로만 한 번도 실행되지 않은 채 "쿼리 수가 그대로"가 성립한다. 썸네일이 붙은 행에서 N+1 회귀가 나도 이 테스트는 통과한다. 썸네일을 심으려면 실제 업로드(MinIO presign)까지 태워야 해서 이번엔 넣지 않았고, 이 경로를 손볼 때는 가드를 믿지 말 것.
