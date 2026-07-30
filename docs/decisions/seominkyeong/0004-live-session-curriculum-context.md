# ADR-0004: 라이브 세션의 커리큘럼 맥락은 기존 레슨 조회 API로 채운다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-07-30
- **관련**: 브랜치 `fix/fe/live-precheck-lesson-index`, [songjeongki/0007](../songjeongki/0007-domain-live-session.md)(모듈 경계 유지), [songjeongki/0029](../songjeongki/0029-lesson-detail-and-display-name.md)(`GET /lessons/{id}` 접근 규칙)

## 맥락 (Context)

'입장 전 점검'(`/student/live-sessions/:sessionId/prejoin`)과 '라이브 시작 전 최종 점검'
(`/instructor/live-sessions/:sessionId/preflight`)의 사이드바가 **해당 커리큘럼의 강의 목차가 아니라
`MY CURATION`(내 커리큘럼 / 내 프로필) 기본 메뉴**를 보여 줬다.

`WorkspaceLayout`은 이미 올바른 로직을 갖고 있었다 — 경로에 `sessionId`만 있으면 세션을 읽어
`curriculumId`를 알아내고, 있으면 `CurriculumLessonNavigation`(강의 목차)을 그린다. mock 구현체에서는
동작했고 통합 테스트(`RouteSmoke.test.tsx`)도 통과했다. **실 서버에서만 깨졌다.**

원인은 HTTP 구현체였다.

```ts
// httpLiveSessionService.normalizeLiveSession (수정 전)
lessonTitle: '',
curriculumId: '',   // ← 이게 falsy라 레이아웃이 기본 메뉴로 폴백
curriculumTitle: '',
sectionId: '',
```

`GET /api/live-sessions/{sessionId}`(`live.api.LiveSessionView`)는 `lessonId`까지만 준다.
live 모듈이 커리큘럼을 참조하지 않기 때문이고([0007](../songjeongki/0007-domain-live-session.md)의
모듈 경계), 그 자체는 옳다. 문제는 FE 어댑터가 **없는 값을 빈 문자열로 채워 계약을 지키는 척한 것**이다
([frontend/AGENTS.md](../../../frontend/AGENTS.md) "Mock과 HTTP는 같은 Interface와 화면 모델을 반환").

같은 빈 값이 사이드바 말고도 두 곳을 조용히 망가뜨리고 있었다.

| 증상 | 빈 필드 |
|---|---|
| 사이드바가 강의 목차 대신 기본 메뉴 | `curriculumId` |
| 두 점검 화면 헤더의 강의 제목이 공백 | `lessonTitle` |
| prejoin의 '강의 상세' 링크가 `/student/curriculums//sections//lessons/x` | `curriculumId`·`sectionId` |

## 결정 (Decision)

1. **`live.api.LiveSessionView`에 커리큘럼을 넣지 않는다.** 모듈 경계를 유지한다.
2. **BE는 고치지 않는다.** 필요한 값은 **이미 있는 `GET /api/lessons/{id}`** 가 전부 준다 —
   `curriculumId`·`curriculumTitle`·`sectionId`·`title`.
3. **FE HTTP 어댑터가 `lessonId`로 그 API를 한 번 더 읽어 맥락을 채운다.** 역할 분기를 두지 않는다 —
   같은 경로가 소유 강사와 활성 수강생 모두에게 열린다(아래 근거).
4. **맥락 조회 실패는 삼킨다.** 못 채우면 빈 값으로 남고 사이드바는 기본 메뉴로 내려간다.
5. **시작 상태 폴링(`getLiveStartStatus`)도 같은 맥락을 채운다.** 이 응답은 세션을 nested로 담아
   캐시를 덮어쓴다.
6. **레이아웃과 페이지가 같은 쿼리 키(`['live-session', sessionId]`)를 쓴다.**
7. **사이드바 컴포넌트는 새로 만들지 않는다.** 커리큘럼 상세가 쓰는
   `CurriculumLessonNavigation`을 그대로 쓴다 — 이 ADR의 변경으로 그게 비로소 동작한다.

## 근거 (Rationale)

- **세션 응답에 커리큘럼을 싣지 않는 이유**: live 모듈이 커리큘럼을 알게 되면
  [0007](../songjeongki/0007-domain-live-session.md)이 세운 "모듈 간 ID/port로만 연결" 규칙이 깨진다.
  화면 하나의 편의로 도메인 의존 방향을 뒤집을 이유가 없다.
- **강사도 공개 레슨 조회로 읽을 수 있는 이유** — `CatalogService.lessonDetail`:
  ```java
  if (!"OWNER_INSTRUCTOR".equals(relationship) && !"ENROLLED".equals(relationship)) {
      throw new LessonAccessDeniedException(...);
  }
  if ("ENROLLED".equals(relationship) && !"PUBLISHED".equals(lesson.status())) {
      throw new LessonNotFoundException(...);   // ← ENROLLED에만 걸리는 게이트
  }
  ```
  미게시(DRAFT) 레슨을 막는 게이트는 **`ENROLLED`에만** 걸린다. 소유 강사 판정도
  `curriculum.getInstructorId().equals(viewer.userId())` 하나뿐이라 **커리큘럼 lifecycleStatus와
  무관**하다 — DRAFT 커리큘럼의 DRAFT 레슨도 소유 강사에게는 열린다. 이 성질은 기존 계약 테스트
  `StudentLessonContractTest.owner_instructor_can_open_own_unpublished_lesson`이 이미 고정하고 있다.
  사전 점검 화면의 강사는 항상 소유 강사다(세션 시작·preflight가 소유권을 요구한다).
- **BE를 고치지 않는 이유**: 처음에는 `GET /instructor/lessons/{id}`에 `curriculumId`·`curriculumTitle`을
  추가하는 방향으로 구현했다. `httpLessonService.getLesson`의 기존 주석("강사 저작은 공개 카탈로그로
  읽지 않는다 — PUBLISHED만 보여 404")과 CONTRACT의 "수강 중이라도 미게시 레슨은 404"를 읽고
  강사에게도 적용된다고 단정한 탓이다. **그 주석이 가리키는 것은 `GET /curriculums/{id}`**(진짜
  PUBLISHED-only)이고 `GET /lessons/{id}`는 다르다. 정본인 `CatalogService`를 확인하자 BE 변경이
  전부 불필요했다 — 공유 계약 확장, 계약 테스트 추가, FE `role` 인자와 6개 호출부 수정이 모두 사라졌다.
- **빈 문자열을 그대로 두지 않은 이유**: `''`는 "값이 없다"를 표현하지 않는다. 화면은 빈 제목을
  렌더링하고, 빈 `curriculumId`로 링크를 조립하고, 사이드바는 조용히 폴백한다. mock은 실제 값을
  주므로 **mock 검증이 이 결함을 전부 가렸다** — 통합 테스트가 초록인데 실서버가 깨진 이유다.
- **실패를 삼키는 이유**: 이 맥락은 사이드바·제목용 부가 정보다. 마이크 점검과 라이브 입장이라는
  필수 흐름을 제목 조회 하나가 막으면 안 된다. 실패 시 동작은 **수정 전과 동일**하므로 회귀가 아니다.
  같은 성질을 이미 `AuxiliaryQueryDegradation.test.tsx`가 지키고 있다.
- **폴링까지 채우는 이유**: 강사가 '라이브 시작'을 누르면 `start-status`를 1초 주기로 폴링하고
  응답의 세션을 `setQueryData(['live-session', ...])`로 캐시에 쓴다. 여기서 맥락을 빼면 시작을 누른
  순간 사이드바가 기본 메뉴로 떨어진다 — 고친 화면이 다시 깨지는 경로다.

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| **(선택) 기존 `GET /lessons/{id}` 재사용** | BE 변경 0줄, 공유 계약 불변, 역할 분기 없음, 제목·링크까지 함께 고쳐짐 | 세션 조회당 요청 1회 추가 |
| (기각) `GET /instructor/lessons/{id}`에 필드 추가 | FE가 강사 축으로 일관되게 읽음 | **처음 구현했다가 되돌림** — 공개 경로가 이미 소유 강사에게 열려 있어 전부 불필요했다. 공유 계약을 넓히고 계약 테스트까지 늘렸다 |
| (기각) `live.api.LiveSessionView`에 커리큘럼 추가 | FE가 요청 1회로 끝남 | live→curriculum 의존 발생([0007](../songjeongki/0007-domain-live-session.md) 위반) |
| (기각) URL에 `curriculumId`를 넣음 | BE 변경 없음, 새로고침에도 견딤 | 빈 `lessonTitle`·깨진 '강의 상세' 링크가 그대로 남음. 세션 키잉 경로를 커리큘럼 축으로 바꿔야 함 |
| (기각) 링크 state로 `curriculumId` 전달 | 가장 저렴 | 새로고침·직접 진입에서 사라짐 |
| (기각) 섹션→커리큘럼을 목록 순회로 역추적 | BE 변경 없음 | 요청 O(N), 소유 커리큘럼이 많으면 점검 화면이 느려짐 |

## 영향·후속 (Consequences)

- **BE 변경 없음.** 필요한 응답은 이미 존재한다.
- **FE 변경**: `httpLiveSessionService`에 `fetchLessonCurriculumContext(lessonId)`를 두고
  `getLiveSession`·`getLiveStartStatus`가 맥락을 채운다. `WorkspaceLayout`이 페이지와 쿼리 키를
  공유한다. 서비스 인터페이스와 6개 호출부는 **손대지 않는다**.
- **계약 자물쇠**: 공유 계약(필드명·상태코드)이 바뀌지 않으므로 신규 계약 테스트는 불필요하다
  ([POLICY](../../harness/POLICY.md)의 🟢 "표준 CRUD·내부 헬퍼"). 이 변경이 의존하는 서버 성질
  — 소유 강사가 미게시 레슨을 열 수 있다 — 은 기존
  `StudentLessonContractTest.owner_instructor_can_open_own_unpublished_lesson`이 이미 고정한다.
  FE 쪽은 `liveSessionService.test.ts`(맥락 채움·요청 경로·실패 시 격하·폴링 응답)와
  `RouteSmoke.test.tsx`(두 점검 화면 사이드바가 커리큘럼 상세와 구조 동일)로 고정했다.
- **알려진 비용**: 세션 조회가 요청 2회가 된다. 점검 화면은 진입 시 1회라 문제되지 않지만,
  세션을 빈번히 재조회하는 화면이 생기면 레슨 맥락을 별도 쿼리 키로 분리해 캐시할 것.
- **알려진 한계**: 맥락 조회 실패를 삼키므로, 서버가 이 값을 주지 못하는 상황에서는 **경고 없이**
  예전 사이드바로 내려간다. 실패와 정상 폴백을 화면에서 구분하지 않는다는 뜻이다.
- **접힘/펼침은 도입하지 않았다**: `CurriculumLessonNavigation`에 그 동작이 없다(섹션별로 펼쳐진 채
  사이드바가 스크롤). 커리큘럼 상세에도 없는 동작을 점검 화면에만 넣으면 두 화면이 갈리므로,
  필요해지면 세 화면 공통으로 넣는다.
