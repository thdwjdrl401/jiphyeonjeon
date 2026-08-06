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

깊은 정보가 필요해지면 **운영 콘솔 안에 읽기 전용 상세**(`/admin/live-sessions/{id}`, 데이터는
`/api/admin/**`)를 만드는 쪽이 맞다 — 게이트를 건드리지 않고도 원하는 것을 다 볼 수 있다.

## 화면

한 칸에 세 줄을 쌓는다: **강의 제목**(판단 근거라 제일 크게) · 커리큘럼(맥락, 링크) · 세션 id(작게).

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
| 방 이름에서 세션 id를 꺼낸다 | `sessionLabel.test.tsx` — 규약과 다른 방 이름은 세션으로 보지 않는다 |
| 링크가 공개 커리큘럼으로만 간다 | 같은 파일 |
| 이름을 못 찾아도 id는 남는다 | 같은 파일 |
