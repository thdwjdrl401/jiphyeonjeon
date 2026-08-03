# ADR-0012: 알림은 읽음·처리 두 축으로 나누고, 클릭 목적지는 저장하지 않고 유형+리소스로 계산한다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책: [../../harness/POLICY.md](../../harness/POLICY.md)

- **상태**: 채택
- **일자**: 2026-08-03
- **관련**: 브랜치 `feat/fe/notification-center`, [CONTRACT §2-4](../../CONTRACT.md#2-4-알림-센터--서버-미구현-fe-완료-be-착수-전),
  [ADR-0005](0005-lesson-has-no-draft-state.md)(레슨에 초안 상태 없음),
  [ADR-0008](0008-route-scroll-reset-policy.md)(스크롤 초기화 정책 — 이 ADR이 보완),
  [choinhoo/ADR-0007](../choinhoo/0007-recording-ready-auto-publish-and-processing-polling.md)(녹화 READY 자동 게시),
  [songjeongki/ADR-0059](../songjeongki/0059-live-processing-status-is-two-axes.md)(녹화 두 상태축)

## 맥락 (Context)

학생·강사 공통 알림 센터(헤더 종·드롭다운·알림 페이지)를 만들어야 했다. 착수 전에 확인한 현재 구조:

- **알림 도메인이 서버에 없다.** `backend/src/main/java/com/liveclass` 아래에 알림 패키지·테이블·
  엔드포인트가 없고, `@Scheduled`는 `LiveStartReconciler`·`AssetReaper`·`OutboxRelay`에만 있어
  시각이 방아쇠인 알림(오늘의 라이브)을 만들 잡이 없다. 실시간 push 채널도 없다.
- **수강 신청은 이미 승인제다.** `EnrollmentStatus`가 `PENDING|ACTIVE|REJECTED|REVOKED|CANCELLED`이고
  강사 승인·거절·제적 API(`POST /instructor/curriculums/{id}/enrollments/{id}/{approve|reject|revoke}`)와
  수강생 명단 화면(`InstructorEnrollmentRoster`)이 구현돼 있다. 커리큘럼별
  `enrollmentPolicyType`이 `IMMEDIATE`면 즉시 확정이다. **요구사항이 예상한 "자동 승인 → 승인제"
  전환 작업은 필요하지 않았다.**
- **녹화 완료와 다시보기 공개가 같은 순간이다.** `RecordingService.markReady`가 Egress COMPLETE
  하나로 `VideoAssetStatus.READY`와 `ReplayStatus.DRAFT → PUBLISHED`를 **같은 트랜잭션**에서 저장한다.
  `READY_FOR_REVIEW`로 가는 코드 경로는 없다(enum에만 존재).
- **강의에는 초안 상태가 없다**(ADR-0005). 학생 노출을 가르는 것은 `curriculum.lifecycleStatus`다.
- **학습 자료는 강의 단위로 존재**하지만 자료 전용 화면이나 탭은 없다 — 강의 상세 안의 한 패널이다.
- 커리큘럼 관리 화면의 탭(`기본 정보`·`구성`·`수강생`)은 **로컬 state**여서 URL로 지목할 수 없었다.

## 결정 (Decision)

1. **읽음(`readStatus`)과 처리(`actionStatus`)를 별개 필드로 둔다.** 읽음 처리는 처리 축을 건드리지
   않고, 처리 축은 관리 화면에서 실제 행동(승인·거절·검수·게시)을 했을 때만 움직인다.
2. **알림에 프론트 경로를 저장하지 않는다.** `type` + `targets`(리소스 id) + **클릭 시점의** 리소스
   상태로 `notificationRouting.resolveNotificationRoute`가 경로를 만든다. 목적지를 만들 수 없으면
   `null`을 돌려주고 이동하지 않는다.
3. **클릭 순서는 읽음 → 대상 재판정 → 이동**으로 고정하고 `useNotificationActivation` 훅 하나에 둔다.
   대상이 사라졌으면(`GONE`) 이동하지 않고 안내만 띄우며 처리 축을 `EXPIRED`로 내린다.
4. **녹화 완료 알림과 "녹화 강의 준비 완료" 알림을 하나로 합친다**(`RECORDING_READY`). 현재 서버에서
   두 상태가 같은 순간이므로 나누면 같은 사건이 두 줄로 보인다.
5. **서버 미구현을 흉내 내지 않는다.** `httpNotificationService`의 모든 메서드는 `notImplemented`로
   501 `API_NOT_IMPLEMENTED`를 던지고, 화면은 그 code를 보고 "준비 중"으로 안내한다. 필요한
   Method·URL·DTO·권한은 [CONTRACT §2-4](../../CONTRACT.md)에 적어 둔다.
6. **관리 화면 탭·수강생 필터·강조 대상을 URL 쿼리로 옮긴다**(`?tab=enrollees&enrollmentStatus=PENDING&highlightEnrollment=…`).
7. **`#anchor`가 있는 이동은 맨 위로 초기화하지 않고 그 영역으로 스크롤한다** — ADR-0008 결정 2를 보완한다.

## 근거 (Rationale)

- **두 축을 나눈 이유**: 하나로 합치면 "읽었지만 아직 승인하지 않은 신청"을 표현할 수 없어 강사가
  할 일 목록을 만들 수 없다. `처리 필요` 필터가 성립하려면 읽음과 무관한 축이 필요하다. 이미 녹화
  상태를 두 축으로 유지하는 판단(ADR-0059)과 같은 이유다.
- **경로를 저장하지 않는 이유**: 저장하면 라우트를 바꿀 때 **이미 쌓인 알림이 전부 깨진다**(고칠
  대상이 코드가 아니라 데이터가 된다). 게다가 같은 알림의 목적지가 상황에 따라 달라야 한다 —
  라이브 일정 알림은 입장 가능 시간이면 입장 준비 화면, 아니면 일정 안내 화면이다. 저장된 문자열로는
  이 분기를 표현할 수 없다.
- **클릭 시점에 다시 판정하는 이유**: 알림이 남아 있는 동안 수강이 취소되고, 커리큘럼이 삭제되고,
  담당 강사가 바뀔 수 있다. 생성 당시 권한으로 이동시키면 빈 화면이나 403이 나온다.
- **학생을 강의실로 직접 보내지 않는 이유**: 강의실은 입장 전 점검 통과 표시를 요구하므로
  (`RequireStudentPrejoinRoute`) 직접 들어가면 점검 화면으로 되돌려진다. 결과가 같아도 한 번
  튕기는 이동은 알림이 깨진 것처럼 보인다. 알림은 점검 화면까지만 데려간다.
- **녹화 알림을 합친 이유**: 요구사항은 "녹화 파일 생성 완료 → 후처리 완료 → 강사 검토 가능 →
  다시보기 게시"가 분리돼 있으면 별도 알림을, 같으면 통합하라고 했다. 실제 코드는 같다.
- **미구현을 501로 남긴 이유**: 없는 경로를 호출하면 404가 오는데 화면에서는 서버 장애와 구별되지
  않는다. 임의 성공 응답으로 대체하면 화면 검증은 통과하고 실제 연동에서만 깨진다
  ([frontend/AGENTS.md](../../../frontend/AGENTS.md) "존재하지 않는 endpoint를 추측해 만들지 않는다").
- **탭을 URL로 옮긴 이유**: "수강생 탭으로 이동"을 링크로 표현할 수 없으면 알림이 관리 화면 첫 탭에
  떨어뜨리고 사용자가 탭을 직접 찾아야 한다. 새로고침·공유·뒤로 가기도 함께 얻는다.
- **hash 스크롤을 넣은 이유**: 자료 전용 화면이 없어 자료 알림은 "강의 상세의 자료 영역"을 가리켜야
  한다. 맨 위로 올려 버리면 그 링크가 일반 화면 이동과 구별되지 않는다. 대상이 아직 렌더되지 않을 수
  있으므로(상세는 조회 후 그려진다) 약 1.5초간 프레임마다 다시 찾고, 못 찾으면 아무 것도 하지 않는다
  — 맨 위로 튀게 만들지도 않는다(사용자가 요청한 위치가 아니다).

## 대안 (Alternatives)

| 대안 | 장점 | 단점 |
|---|---|---|
| **(선택) 읽음·처리 2축 + 목적지 계산 + 501 유지** | 요구 상태 조합을 모두 표현, 라우트 변경에 안전, 미구현이 코드에서 드러남 | 서버 연동까지 실제 알림은 mock 모드에서만 동작 |
| (기각) `status` 하나로 `UNREAD/READ/DONE` | 필드가 적다 | "읽었지만 미처리"를 표현 못 해 `처리 필요` 목록이 성립하지 않는다 |
| (기각) 알림에 `link` 문자열 저장 | 클릭 처리가 단순 | 라우트 변경 시 쌓인 데이터가 깨지고, 상황에 따른 분기(입장 가능 여부)를 표현 못 한다 |
| (기각) 서버가 목적지 화면 이름(`screen`)을 결정 | FE 분기가 줄어든다 | 화면 구성이 서버 계약에 굳어, 탭 하나 옮기는 데 서버 배포가 필요해진다 |
| (기각) HTTP 어댑터에 임의 성공 응답 | 화면이 HTTP 모드에서도 돌아 보인다 | 미구현을 완료로 가장한다. 실제 연동에서만 깨진다 |
| (기각) 녹화 완료·검토 가능 알림 2건 | 요구사항 문구를 그대로 따름 | 현재 서버에서 두 상태가 같은 순간이라 같은 사건이 두 줄로 보인다 |
| (기각) 관리 화면 탭을 로컬 state로 유지 | 변경 없음 | "수강생 탭으로 이동"을 링크로 표현할 수 없다 |

## 영향·후속 (Consequences)

- **FE 신설**: `features/notification/`(타입·Interface·Mock 저장소/이벤트/서비스·HTTP 어댑터·facade·
  이동 규칙·표시 규칙·Query/Mutation·클릭 훅·`NotificationBell`·`NotificationList`·`NotificationRow`),
  `pages/NotificationsPage.tsx`, `styles/notification.css`.
- **FE 변경**: 헤더에 종 추가(알림 → 프로필 순), `/student/notifications`·`/instructor/notifications`
  라우트, `paths.ts`에 `curriculumManage(id, options)`·`getNotificationsPath(role)`,
  `CurriculumManagePage` 탭을 쿼리로, `InstructorEnrollmentRoster`에 초기 필터·강조,
  `Panel`에 `id` prop, `ScrollToTop`의 hash 처리, `WorkspaceUi`·`lessonRouting`에 anchor 상수.
- **Mock 이벤트 배선**: 알림은 도메인 mock 서비스가 발행한다 — `mockEnrollmentService`(신청·승인·거절·
  취소), `mockLessonService`(강의 생성·일정 등록/변경·자료), `mockCurriculumManagementService`(강의
  삭제 → 일정 취소), `mockLiveSessionService`(녹화 READY), `mockReplayService`(검수 저장·다시보기 게시).
  화면 코드는 발행 함수를 직접 부르지 않는다.
- **BE·계약**: [CONTRACT §2-4](../../CONTRACT.md) 신설(미구현 명시). 서버 후속 작업은 그 절 마지막
  항목에 정리했고, 작업 분해·삽입 지점(클래스·메서드)·완료 조건은
  [NOTIFICATION-BACKEND-HANDOFF.md](../../NOTIFICATION-BACKEND-HANDOFF.md)에 인수 문서로 두었다.
  규격은 CONTRACT가 정본이며 인수 문서는 그것을 복제하지 않고 가리킨다.
- **테스트**: `test/features/notification/` 6개 파일 46개(수강 신청 수신자·상태 전이·중복 방지,
  강의·자료·일정, 녹화·다시보기, 조회·필터·페이지네이션·권한·대상 재판정, HTTP 미구현 고정, 이동 규칙),
  `test/integration/NotificationCenter.test.tsx` 8개, `ScrollReset.test.tsx`에 hash 이동 1개 추가.
  전체 760개 통과. `test/setup.ts`에 `Element.prototype.scrollIntoView` 스텁 추가(jsdom 미구현).
- **계약 테스트 판단**: 알림 API가 아직 없어 FE/BE 런타임 계약이 성립하지 않으므로
  [POLICY](../../harness/POLICY.md) 기준의 계약 테스트 대상이 아니다. 대신 "미구현"이라는 현재
  계약을 테스트로 고정했다(`httpNotificationService.test.ts`) — 서버가 생기면 이 파일이 Method·URL·
  DTO 검증으로 바뀐다.
- **남는 제한**: (1) HTTP 모드에서는 알림이 동작하지 않는다(종은 "준비 중" 안내). (2) `LIVE_STARTING_SOON`은
  예약 작업이 없어 mock에서 seed로만 재현된다. (3) 실시간 push가 없어 배지는 60초 폴링이다.
  (4) 자료 게시 전용 사건이 서버에 없어 mock은 "기존 강의에 새 파일 업로드"를 그 사건으로 본다.
  (5) 묶음 표시는 `groupKey`만 준비했고 화면 구현은 하지 않았다.
