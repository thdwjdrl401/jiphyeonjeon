# 알림 센터 백엔드 인수 문서 — **완료됨**

> ⚠️ **이 문서의 역할은 끝났다.** 여기 적혀 있던 "BE 알림 도메인 없음 / FE 어댑터 501" 상태는
> 더 이상 사실이 아니다. 알림 센터는 ADR-0073 여섯 단계가 모두 구현됐다.
>
> - **지금 무엇이 있는지·왜 그렇게 됐는지**: [NOTIFICATION-CENTER.md](NOTIFICATION-CENTER.md)
> - **API 규격의 정본**: [CONTRACT §2-4](CONTRACT.md)
> - **설계 결정**: [ADR-0073](decisions/songjeongki/0073-notification-fanout-architecture.md) ·
>   [ADR-0012](decisions/seominkyeong/0012-notification-center-two-status-axes.md)

이 파일을 지우지 않고 남기는 이유는 CONTRACT·ADR 두 곳에서 링크가 걸려 있고, **"착수 전에
무엇을 몰랐는지"가 기록으로 의미가 있기 때문**이다. 아래는 당시 원문이다.

---

<details>
<summary>착수 전 원문 (2026-08-03 이전)</summary>

# 알림 센터 백엔드 인수 문서 (이슈 초안)

> 📍 **API 규격의 정본은 [CONTRACT §2-4](CONTRACT.md#2-4-알림-센터--다섯-경로-모두-구현됨-나머지-발행-지점은-남음)다.**
> 이 문서는 규격을 **복제하지 않고** 작업 분해·삽입 지점·완료 조건만 담는다(AGENTS.md §7 SSOT).
> 판단 배경은 [ADR-0012](decisions/seominkyeong/0012-notification-center-two-status-axes.md).
>
> GitLab 이슈로 옮길 때는 아래 "이슈 본문" 절을 그대로 붙여 넣으면 된다.

---

## 현재 상태

| 영역 | 상태 |
|---|---|
| FE 타입·Interface·Mock·화면·이동 규칙·테스트 | **완료** (`frontend/src/features/notification/`) |
| FE HTTP 어댑터 | **의도적으로 미구현** — 5개 메서드가 501 `API_NOT_IMPLEMENTED`를 던진다 |
| BE 알림 도메인 | **없음** — 패키지·테이블·엔드포인트·발행 지점·예약 작업 전부 없다 |

FE는 mock 모드에서 전체 흐름이 동작하는 것을 확인했다. 서버가 아래를 채우면 FE는
`httpNotificationService.ts` 한 파일만 바꾸면 되고 화면·Interface·Mock은 그대로다.

---

## 이슈 본문

### 📄 기능 설명

학생·강사 공통 알림 센터의 서버 측을 구현한다. 화면(헤더 종·드롭다운·알림 페이지)과 이동 규칙은
이미 FE에 있고, 서버가 알림을 **저장·조회·상태 전이·발행**하는 부분이 비어 있다.

요청/응답 규격(Method·URL·DTO·상태코드·권한)은 [CONTRACT §2-4](CONTRACT.md#2-4-알림-센터--다섯-경로-모두-구현됨-나머지-발행-지점은-남음)를
그대로 따른다. 이 이슈에서 규격을 새로 정하지 않는다 — 바꿔야 할 부분이 있으면 CONTRACT를 먼저 고치고
FE와 함께 반영한다.

### 작업 분해

#### 1. 스키마 (다음 migration은 `V23__…`)

- `core.notification` 테이블. 컬럼은 CONTRACT §2-4의 응답 필드와 1:1로 두되 `dedupe_key`를 추가한다.
- **`dedupe_key`에 unique 제약을 반드시 건다.** 중복 방지는 애플리케이션 코드가 아니라 DB가 보장해야
  한다 — Egress webhook 재전송처럼 동시에 두 번 들어오는 경우를 코드로 막을 수 없다.
- 키 구성은 `{type}:{recipientId}:{관련 리소스 id}`. 반복되는 사건(일정 변경)은 리소스 부분에 새 시각을
  포함해 두 번째 변경이 첫 번째에 묻히지 않게 한다. 참고 구현: `frontend/src/features/notification/mockNotificationStore.ts`.
- 조회 패턴이 `recipient_id` + 최신순 + 필터이므로 `(recipient_id, created_at DESC)` 인덱스를 둔다.
- `dedupe_key`는 **응답에 노출하지 않는다**(내부 값).

#### 2. 엔드포인트 5개

CONTRACT §2-4의 표 그대로. 권한은 전부 "본인 것만"이며 **남의 알림은 403이 아니라 404**다
(403은 "그 알림이 존재한다"는 정보를 준다).

주의할 것 두 가지:

- **`GET /api/me/notifications/{id}/target`은 대상이 사라져도 정상 200**으로 `{status:"GONE", reasonCode}`를
  준다. 404로 주면 FE가 서버 장애와 구별할 수 없어 "삭제된 알림입니다" 대신 "잠시 후 다시 시도해 주세요"가
  뜬다. 이 응답을 낼 때 서버가 해당 알림의 `actionStatus`를 `EXPIRED`로 내린다.
- **같은 응답의 `state`에 `liveSessionStatus`·`scheduledAt`·`replayStatus`가 있어야 한다.** FE의 목적지
  분기가 이 값들로 갈린다(입장 가능 시간이면 입장 준비 화면, 아니면 일정 안내 / 녹화본이 있으면 검수
  화면, 없으면 처리 현황). 알림 테이블만 조회하면 안 되고 라이브 세션·녹화 자산을 함께 봐야 한다.

#### 3. 발행 지점 5곳

| 사건 | 삽입 위치 | 만들 알림 |
|---|---|---|
| 수강 신청(승인 대기) | `EnrollmentService.apply` (승인제일 때만) | 담당 강사에게 `ENROLLMENT_REQUESTED` (ACTION_REQUIRED) |
| 승인 / 거절 | `EnrollmentService.approve` / `.reject` | 학생에게 `ENROLLMENT_APPROVED` / `_REJECTED`, **그리고 위 강사 알림을 `COMPLETED`로** |
| 학생 신청 취소 | `EnrollmentService.cancel` | 새 알림 없음. 강사의 `ENROLLMENT_REQUESTED`를 `EXPIRED`로 |
| 강의 저장 / 자료 게시 | `InstructorCurriculumService` (강의 생성·수정·자료) | `LESSON_PUBLISHED`·`LIVE_SCHEDULED`·`LIVE_SCHEDULE_CHANGED`·`MATERIAL_PUBLISHED` |
| 강의 삭제 | 같은 서비스의 삭제 경로 | `LIVE_CANCELED` (**삭제 전에** 발행 — 지운 뒤에는 제목·수강생을 알 수 없다) |
| 녹화 완료 / 실패 | `RecordingService.markReady` / 실패 분기 | 강사에게 `RECORDING_READY` / `RECORDING_FAILED` (둘 다 ACTION_REQUIRED) |
| 다시보기 게시 | `ReplayPublicationService.publish` | 학생에게 `VOD_PUBLISHED`, 강사의 `RECORDING_READY`를 `COMPLETED`로 |

수신자 판정 규칙:

- 수강 신청 알림은 **해당 커리큘럼의 실제 담당 강사에게만**. 강사 계정이라는 이유만으로 남의 커리큘럼
  알림을 받지 않는다.
- 라이브·강의·자료·다시보기 알림은 **`EnrollmentStatus=ACTIVE` 학생에게만**.
  `PENDING`·`REJECTED`·`REVOKED`·`CANCELLED`는 대상이 아니다.
- 학생 알림은 커리큘럼이 **게시된 상태(`PUBLISHED`)일 때만** 만든다. 강의에는 초안 축이 없으므로
  (`ADR-0005`) 학생 노출을 가르는 것은 커리큘럼 `lifecycleStatus`다.

FE mock의 같은 판정이 `frontend/src/features/notification/mockNotificationEvents.ts`에 있다.
**mock은 참고 구현이지 계약의 정본이 아니다.**

#### 4. 예약 작업 (`LIVE_STARTING_SOON`)

시각이 방아쇠인 알림이라 사람의 행동으로 만들 수 없다. 현재 `@Scheduled`는
`LiveStartReconciler`·`AssetReaper`·`OutboxRelay`에만 있어 알림용 잡이 없다.

- 강사: 당일 오전 또는 시작 N분 전, 본인이 진행할 라이브
- 학생: 시작 N분 전, 수강 승인된 커리큘럼의 라이브
- 하루에 한 번만 — 멱등 키의 리소스 부분에 날짜를 넣어 잡이 여러 번 돌아도 한 건만 남게 한다
- 주기와 N값은 이 이슈에서 정하고 CONTRACT에 남긴다

#### 5. (선택) 실시간 push

WS/SSE 채널이 없어 FE는 60초 주기로 `summary`를 폴링한다. 채널이 생기면 FE의
`useNotificationQueries.ts`의 `refetchInterval`을 구독으로 바꾼다. 이번 이슈 범위에 넣지 않아도 된다.

### 🎯 기능 도입의 이점

수강 승인·라이브 일정·녹화 결과처럼 **사용자가 자리를 비운 동안 일어난 일**을 지금은 알 방법이 없다.
강사는 수강 신청이 들어온 것을 관리 화면에 직접 들어가야 알고, 학생은 승인 여부를 커리큘럼 상세를
다시 열어 확인해야 한다. 알림 센터가 그 확인 비용을 없애고, `ACTION_REQUIRED`가 강사의 할 일 목록이 된다.

### ⚠️ 잠재적 문제

1. **녹화 완료와 다시보기 자동 게시가 붙어 있다.** `RecordingService.markReady`가 Egress COMPLETE
   하나로 `VideoAssetStatus.READY`와 `ReplayStatus.DRAFT → PUBLISHED`를 같은 트랜잭션에서 저장한다
   (`choinhoo/ADR-0007`). 그래서 강사 `RECORDING_READY`와 학생 `VOD_PUBLISHED`가 **같은 순간에** 나간다.
   동작은 하지만 "녹화 완료만으로 학생 알림을 보내지 않는다"는 요구와는 어긋난다. 진짜로 떼려면
   "강사 검수 후 게시" 흐름을 넣어야 하고(=`READY_FOR_REVIEW`를 실제로 사용) 그건 **별도 이슈**다.
   이 이슈에서는 현재 동작을 그대로 따른다.
2. **읽음과 처리를 하나로 합치면 안 된다.** `readStatus`는 "봤는가", `actionStatus`는 "처리했는가"다.
   읽음 처리 API가 처리 축을 건드리면 `처리 필요` 목록이 성립하지 않는다 — 강사가 알림을 읽은 순간
   승인해야 할 신청이 목록에서 사라진다.
3. **개수는 필터와 무관한 전체 기준**이다. `filter=UNREAD`로 걸러도 `unreadCount`는 전체 미읽음 수다.
   목록과 같은 응답에 담아야 "모두 읽음" 직후 배지만 남는 어긋남이 안 생긴다.
4. **`targets`는 중첩 객체로 계약했다.** 평평하게 내리려면 CONTRACT를 먼저 고치고 FE 매핑을 함께 바꾼다.
5. 알림이 많이 쌓이는 계정에서 목록 조회가 느려질 수 있다. 페이지네이션은 **필수**이며 무제한 응답을
   주지 않는다(FE는 드롭다운 `size=5`, 알림 페이지 `size=8`로 요청한다).

### 완료 조건

- [ ] `core.notification` 테이블 + `dedupe_key` unique 제약 (`V23__…`)
- [ ] 엔드포인트 5개, CONTRACT §2-4의 상태코드·권한 규칙대로
- [ ] 발행 지점 5곳 배선, 수신자 판정 포함
- [ ] `LIVE_STARTING_SOON` 예약 작업, 하루 한 번 멱등
- [ ] **계약 테스트**: 필드명 camelCase, 상태코드(401/404/200-GONE), 남의 알림 404,
      같은 이벤트 재발행 시 1건 유지, `ACTIVE` 아닌 학생 제외
- [ ] FE: `httpNotificationService.ts`의 `notImplemented` 5줄을 `apiClient` 호출로 교체하고
      `test/features/notification/httpNotificationService.test.ts`를 Method·URL·DTO 계약 테스트로 전환
      (`test/features/enrollment/enrollmentService.test.ts`가 그 모양)
- [ ] 같은 시나리오가 mock 모드와 HTTP 모드에서 같은 결과를 내는지 확인
      (frontend/AGENTS.md "로그인·역할·소유권·리소스 상태별 접근 결과가 Mock과 HTTP에서 일치")

### 🔗 관련

- 규격: [CONTRACT §2-4](CONTRACT.md#2-4-알림-센터--다섯-경로-모두-구현됨-나머지-발행-지점은-남음)
- 판단: [ADR-0012](decisions/seominkyeong/0012-notification-center-two-status-axes.md)
- 배경: [ADR-0005](decisions/seominkyeong/0005-lesson-has-no-draft-state.md)(강의 초안 축 없음),
  [choinhoo/ADR-0007](decisions/choinhoo/0007-recording-ready-auto-publish-and-processing-polling.md)(녹화 자동 게시),
  [songjeongki/ADR-0059](decisions/songjeongki/0059-live-processing-status-is-two-axes.md)(두 상태축 원칙)
- FE 참고 구현: `frontend/src/features/notification/mockNotificationEvents.ts`(발행·수신자),
  `mockNotificationStore.ts`(멱등 키), `mockNotificationService.ts`(조회·재판정)

```
/label ~"Type: Enhancement" ~"Priority: Medium" ~"Status: Pending"
```


</details>
