# ADR-0089: 운영 콘솔은 이름을 읽는다 — 조합 전용 모듈과, 링크를 공개 화면에만 거는 이유

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-08-07
- **관련**: [0088](0088-orphan-egress-purge-through-a-narrow-relay.md)(유령 Egress 정리 — 이 화면이 그 도구다),
  [0020](0020-egress-recording-lifecycle.md)(Egress 녹화 생명주기),
  `docs/CONTRACT.md` §운영 콘솔
- **오너 경계**: BE(송정기) — 조합 모듈·엔드포인트 / FE — 표 두 개의 한 칸

## 맥락

운영 콘솔의 두 표가 세션을 **UUID로만** 보여 줬다.

```
운영 현황 · 라이브   62f5c761-6919-496d-942e-31ec8425d47e   LIVE   ...
Egress 관리         session-62f5c761-6919-496d-942e-...     ACTIVE ...
```

이 화면이 존재하는 이유는 **갇힌 세션과 유령 Egress를 사람이 걷어내는 것**이다(ADR-0088). 그런데
강제 정지를 누를지 말지는 **어느 강의인가**에 달려 있다 — 지금 진행 중인 수업이면 누르면 안 되고,
어제 끝난 방에 남은 유령이면 눌러야 한다. 화면에 그 판단 근거가 없었다.

## 결정 1 — 조합은 전용 모듈에서 한다

세션 이름표는 live(세션) + lesson(강의 제목) + curriculum(커리큘럼 제목)을 함께 읽어야 한다.
그런데 **`curriculum → live` 의존이 이미 있다**(다음 예정 라이브 조회, `LiveSessionDirectory`).
live 안에서 curriculum을 읽으면 **순환**이고 `ModularityTests`가 막는다.

그래서 `com.liveclass.admin` 모듈을 새로 만든다. 도메인이 없고 다른 모듈의 포트를 모아 붙이는
일만 한다. **아무도 이 모듈에 의존하지 않는다** — 잎사귀로 두면 여기에 무엇을 더 붙여도 도메인
모듈의 경계가 흔들리지 않는다. 운영 콘솔은 원래 그 성격이다.

**기존 관리 endpoint는 옮기지 않는다.** `LiveAdminController`(live)와 `EgressAdminController`(video)는
각자 자리에 그대로 둔다 — 옮기면 이번 변경이 이름표 하나가 아니라 리팩터링이 된다.

## 결정 2 — 이름표는 별도 조회다

`POST /api/admin/session-labels` → `[{sessionId, lessonId, lessonTitle, curriculumId, curriculumTitle}]`

- **기존 응답을 넓히지 않았다.** `/admin/live/summary`와 `/admin/egress`는 각자 다른 것(상태 집계 ·
  LiveKit 실시간 목록)을 보고 있다. 양쪽에 이름표를 얹으면 같은 조회를 두 응답이 각자 하게 되고,
  Egress 목록은 애초에 DB가 아니라 LiveKit에서 온다.
- **한 번에 여러 개를 받는다.** 표를 그리므로 행마다 부르면 행 수만큼 왕복이 생긴다. 화면이 id를
  모아 한 번 물어보고 각 행은 받은 Map에서 꺼내 쓴다. 상한 200(콘솔 한 화면 분량).
- **조회지만 POST다.** id 여러 개를 쿼리스트링에 늘어놓으면 URL 길이 상한에 걸리고 접근 로그가
  id로 뒤덮인다.
- **못 찾은 것은 비워서 돌려준다.** 세션이 지워진 건이 실제로 있고 — **유령 Egress가 정확히 그
  경우다** — 그때 404를 내면 정리해야 할 바로 그 행이 화면에서 사라진다. 물어본 순서와 개수를
  그대로 지켜 화면이 행을 짝지을 수 있게 한다.

## 결정 3 — 링크는 공개 화면에만 건다

**ADMIN은 도메인 게이트를 통과하지 않는다.** `ROLE_ADMIN`은 `/api/admin/**`만 열고
(`SecurityConfig:78`), 가입 역할이 아니라 로그인 시 얹히는 오버레이다(`AuthController:139`).
그래서 admin 계정도 실체는 STUDENT나 INSTRUCTOR이고, **남의 커리큘럼 화면을 열면 403/404**다.

강의 상세·처리 현황으로 링크를 걸면 **눌리지 않는 링크**가 된다. 그건 없는 것보다 나쁘다.
그래서 링크는 공개 라우트인 `/curriculums/{id}` 하나뿐이다.

**admin에게 모든 화면을 열어 주는 선택지도 있었지만 하지 않았다.** 그러려면 도메인 게이트
15개 파일·`LiveAccessGuard` 호출 37곳에 우회를 넣어야 하고, 그건 **인가 축의 전면 변경**이다.
읽기만 열지 쓰기까지 열지부터 정해야 하고, 한 곳이라도 쓰기 경로에 잘못 뚫리면 admin이 남의
강의를 조작하게 된다. 지금 필요한 것(어느 강의인지 알기)에 비해 대가가 크다.

## 결정 4 — 깊은 정보는 운영 콘솔 안에서 본다

강사 화면을 열어 주는 대신 `/admin/live-sessions/{id}`를 **읽기 전용**으로 만든다. 게이트를 하나도
건드리지 않고 판단에 필요한 것이 다 나온다.

```
세션    상태 · 예정/시작/종료 · 기능 플래그(녹화·자막·채팅·AI) · roomName · roomSid
강의    제목 · 커리큘럼 제목(공개 페이지 링크) · 강사 표시 이름
녹화    자산 상태 · 공개 상태 · 실패 코드 · 길이 · 용량 · 녹화 시각 · 자산 id
Egress  지금 살아 있는 작업(있으면) — 정지·정리는 Egress 콘솔로 보낸다
```

**새 포트를 만들지 않았다.** 전부 이미 있는 것을 조합한다 — 세션은 `LiveSessionDirectory`, 녹화는
`LiveRecordingStatus`(live가 선언하고 video가 구현한다), 제목은 lesson·curriculum, 강사 이름은 auth.
"이 세션의 Egress가 지금 도는가"는 DB가 아니라 LiveKit이 아는 값이라, 화면이 기존
`/api/admin/egress` 목록을 받아 방 이름으로 찾는다.

**여기서 아무것도 바꾸지 않는다.** 정지·정리는 Egress 콘솔이 이미 갖고 있다. 보는 화면과 손대는
화면을 나눠 두면 "보러 왔다가 잘못 누르는" 일이 없다.

**이메일은 담지 않는다.** 누구 수업인지는 표시 이름으로 충분하고, PII는 필요할 때만 꺼내는 것이
규칙이다(`UserDirectory.findContacts`가 따로 있는 이유).

**없는 세션은 404다.** 목록의 이름표는 빈 값으로 채우는데 여기는 규칙이 다르다 — 목록은 행을
짝지어야 하지만, 상세는 주소로 직접 들어오는 화면이라 "그런 세션 없음"을 분명히 말해야 한다.
화면은 그때 "이미 지워진 세션입니다. 유령 Egress를 쫓아 들어왔다면 방은 남아 있고 세션만 사라진
상태입니다"라고 답한다 — 운영자가 다음에 무엇을 할지 정하는 데 필요한 답이 그것이다.

## 화면

한 칸에 세 줄을 쌓는다: **강의 제목**(판단 근거라 제일 크게, 누르면 운영 상세) · 커리큘럼(맥락,
공개 페이지 링크) · 세션 id(작게).

**UUID를 지우지 않는다.** 로그를 찾거나 문의를 받을 때 결국 필요한 값이 그것이다. 이름을 못 찾은
행은 "이름을 찾을 수 없음"으로 두어 실제 제목과 구별한다 — 유령을 정리하려면 그 행이 보여야 한다.

이름표 조회가 실패해도 표는 그대로 그린다. 상태·시각·정지 버튼은 이름과 무관하게 필요하다.

## 검증

| 확인 | 방법 |
|---|---|
| 강의·커리큘럼 제목이 붙는다 | `SessionLabelContractTest#a_session_carries_its_lesson_and_curriculum_titles` |
| 없는 세션이 나머지를 죽이지 않는다 | `#an_unknown_session_comes_back_empty_instead_of_failing` |
| 중복 id는 한 번만 | `#duplicate_ids_are_asked_once` |
| 모듈 순환이 없다 | `ModularityTests` |
| 상세가 판단에 쓰는 값을 담는다 | `#the_detail_carries_what_an_operator_judges_with` |
| 없는 세션은 상세가 없다(404) | `#an_unknown_session_has_no_detail` |
| 방 이름에서 세션 id를 꺼낸다 | `sessionLabel.test.tsx` — 규약과 다른 방 이름은 세션으로 보지 않는다 |
| 제목→운영 상세, 커리큘럼→공개 페이지 | 같은 파일 |
| **강사 화면으로는 링크하지 않는다** | 같은 파일 — `/instructor/`·`/student/` href가 없음을 못 박는다 |
| 이름을 못 찾아도 id·상세 링크는 남는다 | 같은 파일 |
