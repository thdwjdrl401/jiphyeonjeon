# ADR-0033: 학습 상태 배선 — 진도·북마크, 클라이언트 계산 진도율, SPI 인가, 카탈로그 progress 연결

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-24
- **관련**: [0024](0024-orphan-module-scaffolding.md)(learning 미배선 골격), [0026](0026-catalog-viewer-context.md)(viewerContext·progress 필드), [0029](0029-lesson-detail-and-display-name.md)(수강생 레슨 접근), [0031](0031-account-profile-security.md)(SPI 가드 패턴), Jira liveclass-102

## 맥락

`learning` 패키지는 [0024]가 정리한 대로 도메인(`LearningProgress`·`Bookmark`)과 테이블(Flyway V1)만 있고 **서비스·리포지토리·포트·web·인가가 전부 없는 골격**이었다. 그 결과 [0026]의 카탈로그 `progress`(내 수강 목록·상세 진도)는 계약상 필드만 있고 **항상 null**이었다. FE는 라이브 북마크(`saveBookmark`)만 호출하며 `notImplemented`로 막혀 있었다.

세 엔드포인트를 배선한다: `GET /lessons/{id}/learning-context`·`PUT /lessons/{id}/progress`·`POST /lessons/{id}/bookmarks`.

## 결정

### 1. 진도율은 클라이언트가 계산하고 서버는 저장·검증한다

VOD 재생이라 브라우저가 재생 위치·유효 시청량을 안다. 서버가 `watched_ranges`를 병합해 재계산하는 정교한 방식(DDL이 상정한 설계)은 이번 범위 밖으로 두고, 클라이언트가 보낸 `progressPercent`를 신뢰한다. 서버는 두 가지 방어만 얹는다.

- **순서역전 방어**: `clientUpdatedAt`이 저장값보다 뒤일 때만 반영한다(진도 후퇴 방지, DDL `client_updated_at` 설계). 저장값이 없으면(첫 저장) 그대로 반영.
- **완료 sticky**: `progressPercent`가 **90%**(DDL 주석 "90% 돌파"와 같음)를 넘으면 `completedAt`을 한 번 찍고, 이후 진도율이 내려가도 유지한다.

`progressPercent`는 0~100 clamp. `watched_ranges`는 이번엔 다루지 않고 빈 배열(`[]`)로 둔다.

### 2. 완료 판정과 카탈로그 집계는 "완료 레슨 수" 기준

레슨 완료 여부는 `completedAt` 유무로 파생한다. 커리큘럼 진도(`CatalogProgress`)는 **`completedLessonCount / totalLessonCount`** — 레슨별 진도율 평균이 아니라 "몇 강을 끝냈나"다. 사용자에게 직관적이고 계약의 `completedLessonCount` 필드와 맞는다. `lastLearning`은 가장 최근 갱신한 진도의 레슨·위치.

### 3. 인가는 learning이 선언하고 curriculum이 구현하는 SPI 포트

`learning`은 하위 모듈이다 — `curriculum`이 카탈로그 progress를 읽으려 `learning.api`(`LearningDirectory`)를 참조한다(`curriculum → learning`). 그런데 learning의 인가(수강자 확인)는 레슨→섹션→커리큘럼→수강 관계가 필요해서 curriculum을 참조하면 **순환**이 된다([0031]의 탈퇴 가드와 같은 구조).

그래서 "학습해도 되는가"를 learning이 인터페이스로 선언하고, 관계를 아는 curriculum이 구현한다.

```
learning.api      interface LessonLearningAccess { void ensureCanLearn(userId, lessonId); }
                  class LessonNotLearnableException (Reason: NOT_FOUND | FORBIDDEN)  ← learning 소유
curriculum.service class LessonLearningAccessImpl implements ...  ← lesson→section→enrollment
```

의존 방향은 `curriculum → learning`으로 progress 조회와 같다. `LearningService`가 주입받아 호출하고, 예외 타입은 learning이 소유해 learning의 예외 핸들러가 매핑한다(구현 모듈 예외를 참조하면 순환). `ModularityTests` 통과.

인가 규칙은 수강생 레슨 상세([0029])와 같은 계열: 없으면 **404**(존재 은닉), 활성 수강생이 아니면 **403**(`ENROLLMENT_REQUIRED` — 목차 access와 같은 코드로 FE가 같은 수강 동선으로 다룬다). 진도는 학생 기능이라 소유 강사는 대상이 아니다(미수강으로 403).

### 4. 카탈로그 progress는 배치로 채운다(N+1 회피)

- **상세**(`detail`): 목차 레슨 id를 모아 `computeProgress(userId, lessonIds)` 한 번.
- **내 수강 목록**(`myEnrollments`): 섹션·게시레슨·진도를 각각 **IN 쿼리 한 번씩** — `SectionRepository.findByCurriculumIdIn` + `LessonDirectory.findPublishedBySections` + `LearningDirectory.findProgress`로 커리큘럼당 반복 없이 전체를 집계.
- 채우는 대상은 **ENROLLED(활성 수강)만**. GUEST·PENDING·강사는 null 그대로.

## 근거

- 클라이언트 계산은 [0013] 통합 스트리밍·VOD 전제와 맞는다 — 서버가 재생 타임라인을 알 필요가 없다. 정교화(watched_ranges)는 값을 지어내지 않고 후속으로 미룬다.
- SPI 포트는 Modulith에서 하위 모듈이 상위 사정을 동기로 물어보는 표준이다([0031]에서 검증). 이벤트로는 "학습 막기"의 동기 거부를 못 한다.
- 완료 레슨 수 집계는 화면이 이미 쓰는 `completedLessonCount`/`totalLessonCount`와 정합.

## 대안

| 주제 | 대안 | 기각 이유 |
|---|---|---|
| 진도율 | 서버가 watched_ranges 병합해 계산 | 이번 범위엔 과함 — 클라가 아는 값을 서버가 재구성할 근거가 약함. 후속 |
| 완료 임계 | 100% | DDL 주석이 90%이고, 마지막 프레임 도달이 어려워 100%는 사실상 완료 불가. 90% 채택 |
| 순환 회피 | curriculum이 인가까지 판정해 learning에 주입 안 함 | learning이 인가 없이 진도를 쌓으면 미수강자도 저장 가능. SPI가 경계를 지키는 정석 |
| 북마크 중복 | uq 충돌을 예외로 잡아 기존 반환 | `@Transactional`이 rollback-only로 오염된다 — **사전 조회**로 바꿈 |

## 영향·후속

- **검증**: `ModularityTests` 통과(순환 없음), `LearningContractTest` 8건 — 진도 upsert·90% 완료 sticky·순서역전 방어·북마크 멱등·미수강 403·없는 레슨 404·잘못된 진도율 400·**카탈로그 progress가 더는 항상 null이 아님**(상세 + 내 수강 목록).
- **FE**: `httpLiveSessionService.saveBookmark`를 실제 호출로 연결(mock과 정합). `learning-context`·`progress`는 아직 화면에서 쓰지 않아 어댑터 미배선 — 화면이 생기면 그때 연결한다.
- **엔티티 기본값**: `learning_progress`의 `last_position_ms`·`progress_percent`·`watched_ranges`는 NOT NULL이다. DB DEFAULT는 컬럼 미지정 INSERT에만 적용되므로, JPA가 값을 실어도 위반되지 않도록 엔티티에 기본값(`0`·`"[]"`)을 뒀다.
- **후속**: watched_ranges 기반 유효시청량·되감기 감지(정교한 완료 판정), 공개 목록(`list`)의 progress(현재는 상세·내 수강 목록만), learning-context/progress의 FE 화면 배선.
