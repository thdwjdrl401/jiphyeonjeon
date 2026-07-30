# ADR-0050: 라이브 채팅 익명은 기본값이 아니라 발신자 선택

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택 (BE + FE 구현)
- **일자**: 2026-07-30
- **관련**: [0019](0019-ws-realtime-chat-stomp.md)(WS 실시간 채팅), 공유 계약 [../../CONTRACT.md](../../CONTRACT.md) §2 채팅, FE 문서 `docs/frontend/api/LIVE.md` §9
- **부분 supersede**: [ADR-0005](../yoongwanghyeok/0005-question-insights-and-synchronized-replay.md) §6·[ADR-0006](../yoongwanghyeok/0006-vod-publication-review-and-learning.md) §11의 "학생 채팅은 가명" 전제 중 **채팅 표시 이름** 부분. 두 ADR의 다른 결정(강사에게 userId·실명 미제공, 질문 인사이트 익명 집계, VOD 리플레이가 당시 이름을 유지)은 **그대로 유지**한다. 다른 오너의 문서라 그 파일을 수정하지 않고 여기서 관계만 밝힌다.

## 맥락

`ChatService`가 발신자 역할만 보고 익명을 정했다.

```java
boolean anonymous = !"INSTRUCTOR".equals(sender.role());   // 학생은 항상 익명
m.setSenderName(anonymous ? studentAlias(session.getId(), senderId) : sender.displayName());
```

그래서 **학생 메시지는 예외 없이 `수강생-0473` 가명**으로 나갔고, 본인이 지정한 표시 이름은 채팅에
드러날 방법이 없었다. `SendChatMessageRequest`에 익명 여부를 담을 필드조차 없어 클라이언트가 선택할
수도 없었다.

이건 프라이버시 보호 의도였지만 실사용에서 두 가지가 어긋났다.

1. **수업에서 서로를 부를 수 없다.** 스터디·소규모 강의에서는 이름으로 지목하고 답하는 것이 정상이고,
   모두가 `수강생-XXXX`면 대화가 성립하지 않는다.
2. **선택권이 없다.** 민감한 질문은 익명으로, 평범한 발언은 이름으로 하고 싶은 것이 자연스러운데
   시스템이 한쪽만 강제했다.

## 결정

1. **익명은 메시지마다 발신자가 선택한다.** `SendChatMessageRequest.anonymous`(Boolean)를 추가하고,
   **생략·`false`면 표시 이름**, **`true`면 세션 한정 가명**으로 저장한다.
2. **기본값은 "익명 아님"이다.** 생략 시 `false`로 본다. 이유 — 이 값은 발신자가 UI에서 명시적으로
   켜는 스위치이고, 기본을 익명으로 두면 (a) 이름을 쓰려는 다수가 매번 끄는 조작을 해야 하고
   (b) 필드를 빠뜨린 클라이언트가 조용히 전원 익명으로 회귀해 원래 버그가 되살아난다. 기존
   `isQuestion`도 "생략 시 false" 규약을 쓴다.
3. **강사는 어떤 경우에도 익명이 될 수 없다.** 요청이 `anonymous=true`여도 서버가 무시한다. 강사 발언의
   출처는 수업 진행상 드러나야 하고, 익명 강사는 사칭·혼선의 여지만 만든다.
4. **가명/표시 이름은 저장 시점에 확정해 `sender_name`에 넣는다**(기존 구조 유지). 응답을 만들 때
   실명이나 `userId`로 되돌아가 계산하지 않는다.
5. **유지되는 불변식** — 이번 변경으로도 다음은 그대로다.
   - 응답·WS payload에 **`userId`를 넣지 않는다.**
   - 익명을 끌 때 노출되는 것은 **발신자가 스스로 지정한 표시 이름**뿐이고, 시스템이 가진 실명·계정
     식별자를 꺼내 보이는 것이 아니다.
   - 강사 화면의 질문 인사이트는 계속 **원문·시점만 익명 집계**로 제공한다(ADR-0005 §6).

## 근거

- **선택 스위치를 서버가 대신 결정하면 안 된다.** 익명 여부는 발신자의 의사이지 역할에서 파생되는
  속성이 아니다. 역할로 고정했던 것이 문제의 원인이었다.
- **가명 자체는 남긴다.** 익명을 켠 메시지는 여전히 `수강생-XXXX` 형태의 **세션 한정** 가명이라,
  세션 밖으로 추적되지 않는다(`hash(sessionId + userId)`).
- **표시 이름 ≠ 실명 노출.** 사용자가 프로필에 넣은 표시 이름을 그대로 쓰는 것이므로, 노출 범위를
  사용자가 이미 통제하고 있다. 시스템이 실명 필드를 별도로 꺼내는 것이 아니다.

## 부수 결정 — 내 메시지 우측 정렬

`ChatMessageResponse.mine`(요청자 본인 여부)은 이미 있었으나 **FE가 쓰지 않아** 모든 메시지가 같은
모양으로 좌측에 쌓였다. 이번에 FE가 이 값을 받아 **내 메시지는 우측, 나머지는 좌측**으로 그린다.
강사·수강생이 같은 컴포넌트를 쓰므로 두 화면이 함께 통일된다.

- **`mine`은 WS 브로드캐스트 payload에 넣지 않는다.** 토픽 브로드캐스트는 뷰어별로 값을 달리할 수
  없다 — 넣으면 발신자 기준으로 굳어 남의 화면에서도 우측에 붙는다. 라이브 중 판별은 **내가 만든
  `clientMessageId` 대조**로 하고, REST(조회·전송 응답)에서는 서버가 준 `mine`을 쓴다. 그래서
  새로고침·재접속·다른 기기에서도 정확하다.
- 내 말풍선에는 **이름을 쓰지 않는다** — 우측 정렬 자체가 "내 것"이라는 표시이고, 좁은 사이드바
  (370px)에서 중복 정보는 공간만 먹는다.

## 영향·후속

- **변경**: `SendChatMessageRequest`(+`anonymous`), `ChatService`(선택 반영·강사 무시),
  `ChatController`·`ChatWsController`·`ChatMessageStoredEvent`·`ChatMessagePayload`,
  FE `liveSessionService`(입력 타입 `SendChatMessageInput`)·`httpLiveSessionService`·
  `mockLiveSessionService`·`LiveClassroomPage`(익명 체크박스·낙관적 항목)·`LearningSidebar`(정렬)·
  `learning.css`·`design-system.css`(ink 대비).
- **문서**: 공유 계약 §2 채팅 행, `docs/frontend/api/LIVE.md` §9, `ChatMessageResponse` 주석.
- **계약 테스트**: 익명 true→가명 / false·생략→표시 이름 / **강사는 요청해도 실명** / `mine`이 요청자
  기준으로 정확 / 전송 payload에 `anonymous`가 실린다 / 정렬 클래스와 낙관적 항목.

## 남은 이슈

- **과거 메시지는 그대로다.** `sender_name`을 저장 시점에 확정하므로, 이 변경 이전에 쌓인 학생
  메시지는 계속 가명으로 보인다. 소급 전환은 하지 않는다 — 그때 발신자는 익명을 전제로 말했고,
  나중에 이름을 붙이는 것은 발신자 의사를 뒤집는 일이다.
- **표시 이름 중복.** 동명이인이면 화면에서 구분되지 않는다. 지금은 `userId`를 노출하지 않는다는
  불변식이 더 중요해 감수한다. 필요해지면 세션 내 중복에만 접미사를 붙이는 방안을 검토한다.
- **익명 선택의 지속성.** 체크 상태는 화면 로컬이라 새로고침하면 꺼진다. "이 세션에서는 계속 익명"
  같은 기억은 요구가 생기면 별도로 다룬다.
