# ADR-0085: 알림 재판정의 게이트를 종류에 맞춘다 — 받는 사람과 취소의 의미

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-08-05
- **관련**: [0073](0073-notification-fanout-architecture.md)(알림 팬아웃 구조 — §8이 이 재판정을 정의한다),
  [0076](0076-enrollment-notification-action-axis-settlement.md)(처리 축 정리 — 같은 재판정 경로를 고쳤다),
  [0012](../seominkyeong/0012-notification-center-two-status-axes.md)(두 상태축·이동 규칙),
  `docs/CONTRACT.md` §2-4
- **오너 경계**: BE(송정기) — 재판정 게이트 / FE(윤광혁) — 자료 알림 목적지 한 줄

## 맥락

알림을 눌러도 화면이 열리지 않는다는 보고가 있었다. 눌러 보면 이동 대신 안내 문구만 뜬다.

재판정(`GET /api/me/notifications/{id}/target`)이 `GONE`을 주고 있었다. 이동 규칙 자체는 멀쩡했다 —
`resolveNotificationRoute`는 12종 전부에 목적지를 갖고 있고 단위 테스트도 통과한다. **깨진 것은 이음매**다.
FE 테스트는 자기가 만든 `state`를 넣어 보는데, 서버는 그런 `state`를 **애초에 만들어 주지 않았다**.

세 갈래였다.

### 1. 받는 사람 본인이 자기 알림에서 막혔다

접근 규칙 표(`NotificationAccessRule`)의 기본값은 `ACTIVE_STUDENT`, 즉 "수강 중이어야 한다"다.
표는 학생을 기준으로 쓰였는데, **강사는 자기 커리큘럼에 수강 등록돼 있지 않다**(`core.enrollment`에
행이 없다). 그래서 강사에게만 가는 알림과 강사도 함께 받는 알림이 전부 막혔다.

| 알림 | 받는 사람 | 그때 판정 |
|---|---|---|
| `RECORDING_READY` | 담당 강사 **한 명** | `ACCESS_REVOKED` — 항상 |
| `RECORDING_FAILED` | 담당 강사 **한 명** | `ACCESS_REVOKED` — 항상 |
| `LIVE_STARTING_SOON` | 수강생 전원 **+ 담당 강사** | 강사만 `ACCESS_REVOKED` |

녹화 두 종류는 학생에게 아예 가지 않는다(`NotificationFanoutWorker.INSTRUCTOR_TYPES`). 즉
**받을 수 있는 유일한 사람이 열 수 없는 알림**이었다. 곧 시작 알림은 ADR-0073 시점에 "강사만 못 받는"
문제를 고쳐 발행까지는 갔는데, 열람이 같은 이유로 다시 막혀 있었다.

### 2. 취소 알림이 취소됐다는 이유로 닫혔다

재판정 4단계는 그 강의의 라이브가 `CANCELLED`면 `TARGET_EXPIRED`를 준다. 의도는
"입장 화면이 사라졌다"였는데, **알림 종류를 가리지 않고** 걸려 있었다.

- `LIVE_CANCELED`(취소 통보) 자신이 걸린다. 학생이 "라이브가 취소되었습니다"를 누르면
  **"처리 가능 기간이 지난 알림입니다"**가 뜬다. FE에 이 종류의 목적지(강의 상세)가 분명히
  적혀 있는데 도달할 수 없는 코드였다.
- 같은 강의에 걸린 `MATERIAL_PUBLISHED`·`VOD_PUBLISHED`도 함께 닫힌다. 라이브가 취소돼도
  그 강의와 자료는 그대로 볼 수 있는데도.
- `GONE`은 처리 축을 `EXPIRED`로 내리므로, 열람 실패가 **데이터까지** 바꿨다.

### 3. 커리큘럼 전체 자료는 목적지가 없었다

서버는 레슨 자료와 커리큘럼 자료를 `lessonId`의 유무로 구분해 보낸다 —
`attachCurriculumMaterial`은 `lessonId`를 비워 보내고, 그 자리에 주석까지 있다
("화면이 커리큘럼으로 보낸다"). 그런데 FE는 `MATERIAL_PUBLISHED`를 무조건 강의 상세 경로로만
만들었고, `lessonId`가 없으면 `null`이 되어 "이동할 수 있는 화면이 없습니다"로 끝났다.

### 4. 업로드 강의가 라이브 강의 화면으로 갔다

업로드 강의(`delivery_type = 'RECORDED'`)도 자료를 갖는다
(`httpCurriculumManagementService`가 `/instructor/lessons/{id}/materials`로 올린다). 그런데
재판정 상태에 **전달 방식이 없어서** 화면이 구별할 수 없었다. 이 앱은 이미 전달 방식을 아는
경로 계산기(`resolveLessonPath`)를 갖고 있는데, 알림만 그것을 쓰지 않고 라이브 경로를 직접 만들었다.
강사가 업로드 강의 자료 알림을 누르면 라이브 강의 상세가 열린다 — 그 강의에 없는 것(라이브 일정,
라이브 편집 링크)을 전제한 화면이다.

### 5. 브라우저 푸시를 누르면 404가 떴다

알림을 여는 길은 **둘**이다. 알림함의 줄을 누르는 길과, 탭이 닫혀 있을 때 오는 **브라우저 푸시**를
누르는 길. 두 번째는 아무도 보지 않고 있었다.

서비스워커는 로그인 세션도 역할도 모르므로 서버가 푸시 본문에 URL을 담아 준다. 그런데
`WsNotificationBroadcaster:105`가 `url`을 항상 `null`로 넘겨서 `PushPayload`가 기본값
`/notifications`를 쓴다. 그리고 **`/notifications`는 등록된 라우트가 아니다** — 실제 화면은
`/student/notifications`와 `/instructor/notifications`뿐이라 `*`에 걸려 "요청한 페이지를 찾을 수
없어요"가 뜬다.

알림을 눌렀는데 404가 뜨는 것은 **알림이 깨진 것과 구별되지 않는다.**

### 6. 업로드 강의 자료 영역에 anchor가 없었다

`LESSON_MATERIALS_ANCHOR`는 라이브 강의 상세에만 붙어 있었다. 업로드 강의 상세에도 자료 영역이
있는데 id가 없어서, ④를 고쳐 그 화면으로 보내도 자료 영역으로 내려가지 않는다(`ScrollToTop`이
1.5초 찾다 포기한다).

### 7. 내린 다시보기를 계속 보냈다

"다시보기가 공개되었습니다"를 받은 뒤 강사가 철회하면(`WITHDRAWN`) 재생 게이트가 404
`게시된 다시보기가 없습니다`를 준다(`ReplayPlaybackService.requirePlaybackContext`). 화면에는
**"다시보기를 불러오지 못했습니다"** — 서버 장애와 구별되지 않는 문구다. 재판정은 `replayStatus`를
이미 손에 쥐고도 그것을 판정에 쓰지 않았다. 계약상 재게시해도 다시 알리지 않으므로, 학생 손에 남은
이 알림은 **정상적으로 생길 수 있는 상태**다.

## 결정

**게이트를 종류에 맞춘다.** 규칙을 종류마다 하나씩 늘리지 않고, 세 곳만 고친다.

**① 담당 강사는 종류를 가리지 않고 통과한다.**

```java
if (viewerId.equals(curriculum.instructorId())) {
    return true;
}
```

규칙 표보다 **먼저** 본다. 자기 커리큘럼의 알림에서 그 커리큘럼의 주인이 막힐 이유는 어떤 종류에도
없다. 표는 그대로 두되(남의 커리큘럼 알림은 여전히 막힌다), `PUBLISHED_CATALOG`에 붙어 있던
`|| viewerId.equals(instructorId)` 예외를 여기로 올려 한 곳에서만 판단한다. 규칙 표에는
`RECORDING_READY`·`RECORDING_FAILED` → `INSTRUCTOR_OWNER`를 명시한다 — 통과 여부는 ①이 이미
결정하지만, 표만 읽는 사람에게 "이건 강사 알림"이라는 사실이 보여야 한다.

**② 라이브 취소를 만료로 보는 것은 입장을 안내하던 셋뿐이다.**

```java
private static final Set<String> ENTRY_TYPES = Set.of(
        LIVE_SCHEDULED, LIVE_STARTING_SOON, LIVE_SCHEDULE_CHANGED);
```

이 셋은 데려갈 입장 화면이 사라졌으니 `TARGET_EXPIRED`가 맞다. `LIVE_CANCELED`는 여기 없다 —
**취소를 알리는 알림이 취소를 이유로 닫히면 정확히 그 알림만 열리지 않는다.** 나머지 종류는 라이브와
무관하게 자기 대상을 갖는다.

**③ 자료 알림의 목적지는 `lessonId`의 유무가 가른다.** 있으면 강의 상세의 자료 영역(`#lesson-materials`),
없으면 커리큘럼 상세다. 서버가 이미 그렇게 구분해 보내고 있었으므로 계약 변경이 아니라 **누락을 채우는
것**이다.

**④ 재판정 상태에 `deliveryType`을 싣는다.** 서버는 이미 `LessonDetailView`로 읽고 있던 값이라
새 조회가 없다. 화면은 **강사 경로에서만** 이것으로 갈린다 — 업로드 강의는 `recorded-lessons/:id`,
라이브 강의는 `lessons/:id`. 학생은 전달 방식과 무관하게 같은 상세 화면을 쓴다(`resolveLessonPath`와
같은 규칙이다. 그쪽은 목차가, 여기는 알림이 부를 뿐이라 규칙이 갈리면 안 된다).

**⑤ 역할 없는 알림함 경로를 만든다.** `/notifications`를 실제 라우트로 등록하고, 그 사람의 알림함으로
넘긴다(`NotificationsRedirect`). 로그인하지 않았으면 `GuestRedirect`가 `returnTo`를 담아 로그인으로
보내므로 로그인 뒤 알림함으로 돌아온다.

**푸시 본문에 실제 목적지를 담지 않는다.** 담으려면 발행 시점에 경로를 굳혀야 하는데, 목적지는 보는
사람의 역할과 클릭 시점의 리소스 상태가 정한다 — 그것을 서버가 미리 정하는 순간 "알림에 경로를 담지
않는다"는 원칙(ADR-0073 §8)이 푸시 쪽으로만 깨진다. 푸시는 알림함까지만 데려가고, 거기서 줄을 누르면
기존 재판정 경로를 그대로 탄다.

**⑥ 업로드 강의 자료 영역에도 같은 anchor를 붙인다.** 목적지를 고쳐도 anchor가 없으면 화면 맨 위에
멈춘다.

**⑦ 게시되지 않은 다시보기는 `GONE`으로 답한다.** `VOD_PUBLISHED`이고 보는 사람이 담당 강사가
아니며 `replayStatus != PUBLISHED`면 `TARGET_DELETED`다. **강사는 막지 않는다** — 철회한 다시보기를
다시 게시하는 자리가 바로 그 화면이고, 재생 게이트도 소유자를 예외로 둔다(`!grant.owner()`).
재판정과 재생이 서로 다른 조건을 쓰면 "열렸는데 재생이 안 되는" 화면이 다시 생긴다.

## 근거

**왜 규칙 표에 종류를 계속 늘리지 않았나.** ①을 `of()`의 분기로 풀면 강사에게 가는 종류가 늘 때마다
표를 함께 고쳐야 하고, 잊으면 정확히 지금과 같은 증상이 다시 난다 — 발행 쪽은 멀쩡한데 열람만
막히고, 그 조합은 발행 테스트로도 라우팅 단위 테스트로도 잡히지 않는다. "커리큘럼 주인"은 종류와
무관한 사실이므로 종류 표 밖에 두는 것이 맞다.

**왜 FE 라우팅이 아니라 서버를 고쳤나(①②).** FE는 서버가 준 `state`만 볼 수 있다. `GONE`이 오면
`state` 자체가 없어서 이동 규칙이 손댈 여지가 없다. 이 셋은 **누가 무엇을 볼 수 있는가**의 판정이고
그건 서버의 몫이다.

**왜 푸시 경로를 아무도 못 봤나.** 서비스워커는 번들 밖 파일(`frontend/public/push-worker.js`)이라
타입 검사도 라우트 검사도 닿지 않는다. `/notifications`라는 문자열이 라우트 표와 맞는지 확인해 주는
것이 아무것도 없었다. 그래서 이번에 **라우트 스모크 테스트**에 넣었다 — 이 경로가 실제 앱에서 어디로
가는지 세 가지(학생·강사·비로그인)로 고정한다. 문자열 자체는 여전히 두 곳에 있지만(번들 밖이라 import가
안 된다), 어긋나면 테스트가 잡는다.

**왜 이 버그가 테스트를 통과했나.** 두 층 모두 자기 층만 검증했다.

- FE `notificationRouting.test.ts`는 12종 전부를 덮지만 `state`를 손으로 만든다 — 서버가 그
  `state`를 주는지는 묻지 않는다. `LIVE_CANCELED` 테스트가 통과하는 동안 그 경로는 **도달 불가능**했다.
- BE `NotificationTargetContractTest`는 커리큘럼·수강만 시드하고 **레슨·라이브 세션을 만들지 않았다**.
  4단계(취소 판정)와 강사 수신 종류가 통째로 검증 밖이었다.

그래서 이번 테스트는 **레슨과 라이브 세션을 실제로 시드한다.** 취소된 세션 하나에 세 종류의 알림을
걸고, 열려야 하는 것과 만료돼야 하는 것을 나란히 확인한다 — 게이트가 다시 종류를 잃으면 두 방향
모두에서 깨진다.

## 그대로 두는 것

같은 훑기에서 나왔지만 **고치지 않기로 한** 것들이다. 판정하지 않는 이유를 남겨 두지 않으면 다음에
같은 자리를 다시 훑게 된다.

| 상황 | 지금 동작 | 그대로 두는 이유 |
|---|---|---|
| 자료가 삭제된 뒤 `MATERIAL_PUBLISHED`를 누름 | 강의 상세가 열리고 **현재** 자료 목록이 보인다 | 자료 한 건이 지워졌다고 강의를 막을 이유가 없다. `materialId`까지 판정하면 "자료 셋 중 하나가 지워졌다"에도 화면이 닫힌다 |
| 녹화 자산이 삭제된 뒤 `RECORDING_READY` | `replayStatus`가 없어 처리 현황 화면으로 간다 | 이미 설계된 갈림길이다(자산 없으면 빈 플레이어 대신 현황) |
| 강조 대상 수강생이 목록에 없음 | 로스터가 안내 문구를 띄운다 | `InstructorEnrollmentRoster`가 이미 처리한다 |
| 커리큘럼이 `DRAFT`·`ARCHIVED`로 내려감 | 학생은 `ACCESS_REVOKED`, 담당 강사는 열린다 | 의도한 동작이다 |
| 강사가 교체됨 | 옛 강사는 `ACCESS_REVOKED`, 새 강사는 열린다 | 소유권을 지금 시점에 다시 읽으므로 자동으로 맞는다 |
| 라이브 세션만 삭제 | — | 일어나지 않는다. `live_session.lesson_id`가 `ON DELETE CASCADE`라 레슨과 함께만 사라지고, 세션 단독 삭제 경로가 없다 |
| `LESSON_PUBLISHED` | 발행 지점이 없다 | CONTRACT에 이미 명시돼 있다(ADR-0005) |

## 결과

- 강사가 녹화 완료·녹화 실패·곧 시작 알림을 눌러 화면으로 간다. 지금까지는 세 종류 다 열리지 않았다.
- 학생이 라이브 취소 알림을 눌러 강의 상세로 간다. 같은 강의의 자료·다시보기 알림도 함께 살아난다.
- 커리큘럼 전체 자료 알림이 커리큘럼 상세로 간다.
- 강사가 업로드 강의 알림을 누르면 업로드 강의 화면의 **자료 영역**이 열린다.
- 브라우저 푸시를 누르면 그 사람의 알림함이 열린다. 지금까지는 404였다.
- 내린 다시보기 알림이 "삭제되었거나 더 이상 접근할 수 없는 알림입니다"로 끝난다 — 재생 404를 만나
  "잠시 후 다시 시도해 주세요"를 보던 자리다.
- 열람이 처리 축을 잘못 `EXPIRED`로 내리던 경로가 사라진다.
- FE 목(`mockNotificationService`)도 같은 규칙으로 맞췄다. 목은 `LIVE_CANCELED` 예외를 **이미
  갖고 있었다** — 서버만 그것을 잃은 상태였고, 그래서 목으로 개발할 때는 정상으로 보였다.
- **이미 잘못 `EXPIRED`가 된 행은 되돌리지 않는다.** 되돌릴 근거가 로그밖에 없고, 그 알림들은
  읽음 축이 살아 있어 목록에서 여전히 보인다 — 잘못 만료된 것은 전부 `INFO`(처리 대기가 아닌) 종류라
  배지 숫자에 영향이 없다. 마이그레이션을 쓸 만한 피해가 아니다.

## 검증

| 확인 | 방법 |
|---|---|
| 강사가 녹화 알림을 연다 | `NotificationTargetContractTest#a_recording_notice_opens_for_the_owning_instructor` |
| 취소 알림이 강의로 간다 | `#a_cancel_notice_opens_the_lesson_instead_of_expiring` |
| 같은 강의의 자료 알림이 살아 있다 | `#a_material_notice_survives_a_cancelled_live_on_the_same_lesson` |
| 입장 알림은 여전히 만료된다 | `#an_entry_notice_for_a_cancelled_live_is_expired` |
| 남의 커리큘럼 알림은 여전히 막힌다 | `#an_instructor_notice_needs_ownership`(기존) |
| 커리큘럼만 남고 강의만 지워진 경우 | `#a_deleted_lesson_is_gone_even_when_the_curriculum_survives` |
| 내린 다시보기는 학생에게 닫힌다 | `#a_withdrawn_replay_is_gone_for_the_student` |
| 내린 다시보기도 강사에게는 열린다 | `#a_withdrawn_replay_still_opens_for_the_owning_instructor` |
| 상태가 전달 방식을 싣는다 | `#the_state_carries_the_delivery_type_so_uploaded_lessons_get_their_own_screen` |
| 커리큘럼 자료 목적지 | `notificationRouting.test.ts` — "커리큘럼 전체 자료 알림은 커리큘럼 상세로 간다" |
| 업로드 강의 목적지 | `notificationRouting.test.ts` — "업로드 강의 알림은 강사를 업로드 강의 화면으로 보낸다" |
| 푸시 클릭이 각자의 알림함으로 간다 | `RouteSmoke.test.tsx` — 학생·강사·비로그인 세 가지 |
