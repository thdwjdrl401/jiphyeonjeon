# ADR-0084: 대기실을 만들지 않고 강의실 안에서 기다린다 — 시작 신호를 상태 토픽에 싣는다

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책:
> [../../harness/POLICY.md](../../harness/POLICY.md) · 공유 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-08-05
- **관련**: [choinhoo/ADR-0003](../choinhoo/0003-simple-live-end-sequential-process.md)(세션 상태 토픽 — 종료 쪽),
  [choinhoo/ADR-0002](../choinhoo/0002-live-start-egress-stt-orchestration.md)(비동기 시작 게이트 — STARTING/LIVE 전이),
  [ADR-0060](0060-live-presence-counts-subscriptions.md)(같은 토픽의 접속자 수),
  [ADR-0032](0032-media-playback-hls-only.md)(수강생은 HLS 전용),
  [ADR-0065](0065-live-replay-screen-alignment.md)(라이브·다시보기는 한 벌의 화면)

## 한 줄 결정

강사가 시작하기 전에 들어온 수강생을 **강의실 안에서** 기다리게 한다 — 별도 대기실 화면을 만들지
않는다. 그리고 세션 상태 토픽에 **`session.starting`·`session.started`를 추가**한다. 이 신호가 대기
화면에서 재생 화면으로 넘어가는 **유일한 경로**다.

## 무엇이 문제였나

**입장 문은 강사가 아니라 시계가 연다.** `isLiveEntryOpen`은 세션이 `SCHEDULED`여도 예정 시각
10분 전이면 입장을 허용한다. 즉 "들어올 수 있다"와 "강의가 시작됐다"는 **별개의 사실**인데, 강의실은
그 구분을 갖고 있지 않았다.

들어온 수강생이 본 것:

- **영상 자리** — 녹화 자산(`VideoAsset`)은 시작 시점에 만들어진다. 시작 전에 재생 정보를 물으면
  `REPLAY_NOT_FOUND`가 돌아오고 화면에는 **"시청할 수 있는 영상이 없습니다"**라는 오류가 떴다.
  기다리면 되는 상황이 고장으로 보였다. 3초 주기 폴링이라 그 실패를 계속 반복했다.
- **채팅 입력창** — `canUseConversation`이 거짓이면 composer가 `undefined`가 되어 **통째로 사라졌다**.
  채팅이 원래 없는 화면인지 지금만 막힌 것인지 구별할 방법이 없었다.
- **시작해도 그대로였다** — 상태 토픽이 `session.ending`·`session.ended`만 실었다. 시작을 알리는
  이벤트가 없어서, 이미 들어와 있던 사람은 **새로고침해야만** 강의가 시작된 것을 알았다.

`ENDING`·`ENDED`에는 배너가 있는데(`LiveClassroomPage`) 시작 전에는 아무것도 없었다. 종료는 표현하고
시작 전은 표현하지 않은 것이 비대칭의 실체다.

## 결정 1 — 대기실 화면을 만들지 않는다

라우트를 하나 더 두면 "언제 대기실이고 언제 강의실인가"를 판정하는 게이트가 하나 더 생기고, 그 게이트가
`RequireStudentPrejoinRoute`·`isLiveEntryOpen`과 어긋날 자리가 생긴다. 이미 상태에 따라 화면을 바꾸는
곳이 강의실 안에 있다(ENDING·ENDED 배너) — **거기에 시작 전을 하나 더 넣는 것이 일관된다.**

같은 이유로 대기 화면도 플레이어와 **같은 `video-stage` 틀**을 쓴다. 시작되면 이 자리에 플레이어가
들어오는데 틀이 다르면 전환할 때 레이아웃이 한 번 튄다.

- 시작 전에는 **재생 조회를 아예 하지 않는다**(`usePlayback` 비활성). 없는 것이 당연한 자산을 물어
  오류를 받아 놓고 그것을 감추는 것보다, 묻지 않는 편이 정직하고 요청도 줄어든다.
- 잠긴 자리마다 **왜 잠겼는지를 그 자리에서** 말한다. 영상 자리·채팅 입력창·AI 질문·자막 독 넷이다.
  잠금 하나에 안내 하나 — 한 곳에만 적으면 다른 탭을 보는 사람은 읽지 못한다.
- 입력창을 **지우지 않고 잠근다.** AI 패널이 이미 그렇게 하고 있었고(`unavailableNotice`), 채팅만
  사라지는 쪽이었다. 잠긴 자리가 보여야 "지금은 못 쓴다"가 전달된다.
- 안내 문구는 모두 **"자동으로"**를 말한다. 이 안내의 목적은 기다리라는 것이 아니라 **새로고침하지
  않아도 된다**는 것이다.

### `OPEN`을 시작 전으로 묶는다

`OPEN`은 이름과 달리 "문 열림"이 아니다. `SCHEDULED → OPEN`으로 가는 코드는 없고, `setStatus(OPEN)`은
**시작하다 실패해 되돌아오는** 한 곳뿐이다(`LiveStartTransitions`). 시작 전인 것은 마찬가지라 같이 묶되,
이름이 사실과 다르다는 점은 기록해 둔다.

## 결정 2 — 시작 신호를 상태 토픽에 싣는다

도메인 이벤트는 **이미 있었고 이미 발행되고 있었다** — `LiveSessionStartingEvent`(시작 접수),
`LiveSessionStartedEvent`(LIVE 전이). 상태 브로드캐스터가 듣지 않았을 뿐이다. 리스너 두 개를 붙인다.

- 두 이벤트 모두 `AFTER_COMMIT`이라 롤백된 전이는 나가지 않는다. 종료 쪽과 같은 규칙이다.
- 시작 전 수강생도 이 토픽을 **구독할 수 있다** — 구독 인가(`ChatTopicSubscriptionInterceptor`)는
  수강 여부만 보고 상태는 보지 않는다. 배관은 이미 깔려 있었다.
- `session.starting`을 따로 두는 이유: 시작 게이트(STT dispatch·Egress·마이크 확인, choinhoo/ADR-0002)는 수 초가 걸린다.
  이 신호가 없으면 그 구간이 시작 전과 구분되지 않아, 강사가 눌렀는데도 아무 일이 없어 보인다.

### 봉투 시각을 어디서 얻나

- **`session.started`는 `startedAt`을 싣는다.** 이 값은 전이 트랜잭션이 찍은 **세션 시계의 원점**이다
  (`clockOriginAt`과 같은 값). 소비 측이 수신 시각을 다시 찍으면 커밋과 수신 사이의 지연만큼 원점이
  밀린다. `LiveSessionStartedEvent`에 필드를 하나 추가했다 — 호출부는 한 곳이고, 종료 쪽
  `endedAt`과 같은 규칙이 된다.
- **`session.starting`은 발행 시각을 쓴다.** `LiveSessionStartingEvent`는 시작 게이트를 나르는 **작업
  이벤트**라 도메인 시각이 없고, `claim()`이 재구성하기도 해서 실을 값이 없다. 같은 토픽의
  `session.presence`도 같은 규칙이다(ADR-0060).

## 하지 않은 것

- **서버 상태 게이트는 이번에 넣지 않았다.** `LiveAccessGuard`는 수강 여부만 보므로 세션 조회·노트·자막·
  판서 pull은 시작 전에도 응답한다. 채팅·AI는 `LiveInteractionGuard`가 이미 `LIVE·ENDING·ENDED`로 막고
  있어서 **화면에 적은 문구와 서버 응답이 어긋나지는 않는다**. 나머지는 시작 전에 내용이 비어 있어
  새는 것이 없지만, 화면만 고쳤다는 사실은 남는다.
- **`entryOpensAt`은 여전히 죽어 있다.** 강사가 설정한 `entryWindowMinutes`가 API로 내려오고
  `entryOpensAt`까지 계산되는데 **읽는 코드가 없다** — 게이트는 하드코딩 10분을 쓴다. 이번 결정과
  독립이라 건드리지 않았다.

## 되돌리기

FE는 `isPrestartStatus` 분기를 지우면 예전 동작으로 돌아간다. BE 리스너 두 개는 추가만이라
지워도 다른 흐름에 영향이 없다 — 다만 그러면 시작을 알 길이 다시 없어진다.

## 검증

- `LiveChatWebSocketTest.starting_and_started_reach_a_student_who_joined_before_the_lecture_began` —
  **시작 전에 구독**해 두고 시작 신호 두 개를 실제 STOMP로 받는다. 이미 LIVE인 세션에 구독하면
  이벤트가 지나간 뒤라 아무것도 증명하지 못하므로, 세션을 `SCHEDULED`로 두고 시작하는 순서가 핵심이다.
- `LivePrestartClassroom.test.tsx` — 영상 자리에 오류 대신 기다림이 오는지, 채팅 입력창이 사라지지 않고
  잠기는지, AI가 기본 문구("지원하지 않습니다") 대신 대기 문구를 쓰는지, 그리고 시작 신호를 받으면
  **새로고침 없이** 재생 화면과 입력 잠금 해제가 함께 오는지.
- `LiveReplayParity.test.tsx`는 세션을 실제로 LIVE로 만든 뒤 비교하도록 고쳤다 — 이 파일은 그동안
  **시작하지도 않은 강의실**을 "라이브 화면"이라고 비교하고 있었다(데모 세션 기본값이 `OPEN`).
