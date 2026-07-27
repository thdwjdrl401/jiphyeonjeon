# ADR-0041: 강사 저작 읽기는 강사 권한 축으로 · 구조 편집은 자동 저장 · 강사 대시보드 요약

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-27
- **관련**: [0026](0026-catalog-viewer-context.md)(카탈로그 viewerContext), [0030](0030-frontend-unimplemented-api-and-partial-writes.md)(미구현·부분쓰기), [0035](0035-lesson-material-attach.md)(강사 레슨 자료), [0037](0037-enrollment-roster-paging-and-q-deferral.md)(수강 집계)
- **오너 확인 필요**: `frontend/` 코드오너(@yl656982)

## 맥락 (Context)

커리큘럼 생성 → 섹션 → 강의 저작 흐름에서 다섯 가지 문제가 보고됐다. 원인을 코드로 확인한 결과 두 개의 공통 뿌리가 있었다.

**뿌리 A — 강사 저작 화면이 공개 카탈로그로 읽는다.** 사이드바(`CurriculumLessonNavigation`)와 강사 레슨 조회(`getLesson`)가 `GET /curriculums/{id}`를 호출했다. 이 경로는 `CatalogService`가 **PUBLISHED만** 노출하고(비공개는 404), outline에도 **PUBLISHED 레슨만** 담는다. 그래서:
- (#1) 방금 만든 DRAFT 커리큘럼 관리 화면에서 사이드바가 404 → "강의 목록을 불러오지 못했습니다". 권한 문제가 아니라 published-only 가시성 문제였다.
- (#5) 강사가 건 라이브 일정은 `POST /instructor/lessons/{id}/live-sessions`로 정상 저장되는데, 다시 읽을 때 공개 outline에서 읽으니 DRAFT라 빠지고, 강사 레슨 조회(`LessonView`)에는 라이브 세션 필드가 아예 없었다 → 새로고침하면 일정이 사라진 것처럼 보였다.

**뿌리 B — 구조 편집의 저장 경계가 불명확하다.** 관리 화면에서 섹션을 추가하면 클라이언트 임시 id(`sec-new-*`)가 붙는데, "강의 추가"가 그 임시 id로 곧장 링크를 걸어(#3) 존재하지 않는 섹션에 강의를 만들려다 실패했다. "변경 저장"을 눌러야 섹션이 서버에 만들어지는 이원적 흐름이었다.

그 외 독립 문제 둘: 강의 폼 "저장"에 in-flight 가드가 없어 연타 시 매번 새 레슨이 생기고(#4), 강사 대시보드 요약(`/instructor/dashboard-summary`)이 미구현이라 "내 커리큘럼" 상단이 늘 "준비 중"이었다(#2).

## 결정 (Decision)

1. **강사 저작 읽기는 강사 엔드포인트로만 한다(#1·#5).**
   - `GET /instructor/lessons/{id}`(`InstructorLessonResponse`)에 **liveSession을 포함**한다(레슨당 최대 하나 — DDL UNIQUE). 강사 레슨 조회가 라이브 일정을 직접 준다.
   - FE `getLesson`·`getCurriculumLessonNavigation`은 role이 INSTRUCTOR면 공개 카탈로그를 부르지 않고 강사 커리큘럼/섹션/레슨 엔드포인트로 읽는다. 학생 경로는 공개 카탈로그 그대로.
   - 원칙: **쓰기와 읽기를 같은 권한 축에 둔다.** 강사가 쓴 것은 강사 권한으로 읽는다 — 공개 가시성(PUBLISHED)에 얹지 않는다.

2. **커리큘럼 구조·기본정보는 자동 저장한다(#3).** "변경 저장" 버튼을 없애고, 섹션/강의 순서·제목·기본정보 변경을 디바운스 자동 저장한다. 저장이 새 섹션에 실제 id를 부여하면 로컬 상태의 임시 id를 교체한다. **미저장(임시 id) 섹션의 "강의 추가"는 비활성**이라, 존재하지 않는 섹션 URL로 진입할 수 없다.

3. **강사 대시보드 요약을 만든다(#2).** `GET /api/instructor/dashboard-summary` — 커리큘럼 수·공개 수·예정 라이브 수·수강생 합·다음 라이브. 학생 요약(`/me/learning-summary`)과 같은 조립 로직을 `CatalogService`에서 재사용한다.

4. **강의 저장에 in-flight 가드 + 생성 후 이동(#4).** 제출 중에는 버튼을 잠그고, 생성에 성공하면 편집 URL로 이동한다 — "새 강의" 폼에 머물며 연타로 중복 생성되던 것을 구조적으로 막는다.

## 근거 (Rationale)

- **판정·가시성 규칙을 한 곳에.** 공개 카탈로그는 "누구에게 보이는가(PUBLISHED)"를 판정하는 자리다. 강사 저작은 "내 것인가(소유)"가 기준이라 축이 다르다. 저작을 공개 축에 얹으면 DRAFT가 항상 새는 형태로 깨진다.
- **자동 저장이 이원적 흐름을 없앤다.** "저장을 눌러야 섹션이 생긴다"는 숨은 전제가 임시 id 문제의 원인이었다. 자동 저장 + 임시 id 가드로 "저장 안 했는데 강의를 못 만든다"는 상태 자체를 제거한다.
- **부분쓰기 가드는 유지한다(ADR-0030).** 자동 저장은 구조·기본정보만 보낸다. 커리큘럼-레벨 자료는 연결 API가 없어(ADR-0023) 자동 저장 트리거에서 제외하고, 구조 저장 시 현재 자료를 함께 실어 mock이 자료를 잃지 않게만 한다 — 실 API에서는 자료가 비어 있어 [0030]의 가드를 그대로 통과한다.

## 대안 (Alternatives)

| 결정 | 대안 | 기각 이유 |
|---|---|---|
| 강사 레슨 조회에 liveSession 포함 | 레슨의 라이브 세션 전용 GET 신설 | 왕복만 늘고, 수정 폼이 이미 레슨을 조회하므로 한 응답에 담는 게 자연스럽다 |
| 자동 저장(#3-b) | "강의 추가" 시 섹션만 확정 저장(#3-a) | 이원적 저장 흐름이 남고, 사용자가 "저장 시점"을 계속 의식해야 한다 |
| 대시보드 요약을 CatalogService에 | 별도 집계 서비스 신설 | 학생 요약이 이미 거기 있고 enrollment·live·lesson 포트를 다 가짐 — 재사용이 최소 변경 |

## 영향·후속 (Consequences)

- **BE**: `InstructorLessonResponse.liveSession` 추가(응답 확장 — 기존 소비자 무해). `GET /instructor/dashboard-summary` 신설. `EnrollmentDirectory.countActiveByCurriculums`(배치 카운트)·`CurriculumRepository.findByInstructorId`(비페이지) 추가. [CONTRACT §2](../../CONTRACT.md) 갱신.
- **FE**: 사이드바·레슨 폼이 강사 엔드포인트로 읽는다. 관리 화면은 자동 저장(수동 버튼 제거). 강의 폼 제출 가드+이동. 대시보드 요약 실 API 연결.
- **계약 테스트**: BE `InstructorAuthoringReadContractTest`(강사 레슨 liveSession·대시보드 요약) 추가. FE 어댑터 테스트(강사 읽기 라우팅)·통합 테스트(자동 저장 가드·생성 후 이동) 추가.
- **범위 밖(유지)**: 커리큘럼-레벨 자료 편집은 여전히 로컬 스테이징 — 연결 API(CP3, ADR-0023) 전까지 서버 반영 없음. 학생 진도(`learning`)도 배선 전까지 null(ADR-0024).
