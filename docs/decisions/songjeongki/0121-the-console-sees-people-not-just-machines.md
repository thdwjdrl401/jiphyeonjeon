# ADR-0121: 운영 콘솔이 기계 말고 사람을 본다 — 접속자는 STOMP로, 시청은 시청 보고로

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-08-12
- **관련**: [0089](0089-admin-console-reads-names-not-uuids.md)(운영 콘솔의 조합 모듈 — 이 화면이 그 안에 붙는다),
  [0060](0060-live-presence-counts-subscriptions.md)(접속자 수 집계),
  [0063](0063-watch-heatmap-buckets.md)(구간별 시청 보고),
  [0117](0117-progress-settles-when-the-recording-is-ready.md)(진도 환산 배치 — 이 결정이 피해 가는 함정),
  [0032](0032-media-playback-hls-only.md)(학생은 LiveKit 방에 들어오지 않는다),
  [0019](0019-ws-realtime-chat-stomp.md)(단일 인스턴스 전제),
  `docs/CONTRACT.md` §운영 콘솔
- **오너 경계**: BE(송정기) — 포트·조합 모듈·엔드포인트 / FE — 세션 상세의 패널 하나

## 맥락

운영 콘솔이 볼 수 있는 것은 **Egress와 LiveKit**뿐이었다. 둘 다 기계의 상태다. "녹화가 도는가"·
"방이 살아 있는가"는 답해 주지만 **"듣는 사람이 있는가"는 답하지 못한다.**

그래서 강사가 혼자 말하고 있는 세션과 30명이 듣는 세션이 화면에서 똑같이 보였다. 강제 정지를
누를지 판단할 때 정작 필요한 값 — 지금 그 방에 사람이 있는가 — 이 없었다.

## 결정 1 — 라이브 접속자는 STOMP 구독으로 센다 (LiveKit이 아니라)

LiveKit `listParticipants`를 쓰고 싶어지지만 **그러면 청중과 무관한 목록이 나온다.** 수강생은
LiveKit 방에 들어오지 않는다 — 학생 재생은 HLS 단일이다(ADR-0032). 저쪽에 잡히는 것은
강사·Egress·STT 에이전트뿐이라, 그것을 "접속자"로 보여 주면 사람 수가 늘 3 언저리로 고정된다.

강의실을 연 사람은 반드시 세션 토픽을 구독하므로, **구독이 유일하게 정확한 접속 신호**다. 이미
`LivePresenceRegistry`가 그 집계를 하고 있었고(ADR-0060) 밖으로 나가는 것이 숫자 하나뿐이었다.
`LivePresenceDirectory` 포트를 열어 목록을 꺼낸다.

**세는 것과 규칙이 하나 다르다 — 목록은 강사를 빼지 않는다.** "N명 참여 중"은 강사가 자기 청중을
보는 숫자라 자기 자신이 빠져야 하지만, 운영자가 보는 목록은 **강사가 들어와 있는지도** 답해야
한다. 시작은 됐는데 강사가 안 들어온 세션이 실제로 문의가 되는 경우이고, 그때 화면에는 "진행 중"
으로만 보여 정상과 구분되지 않았다. 그래서 강사를 포함해 돌려주고 화면이 갈라 표시한다.

## 결정 2 — 다시보기 시청은 `watch_bucket.updated_at`으로 판정한다

**`learning_progress.updated_at`을 쓰면 조용히 거짓말을 한다.** 진도 환산 배치는 녹화가 준비되는
순간 그 레슨의 **모든** 시청자 행을 한꺼번에 갱신한다(ADR-0117). 그 컬럼으로 "지금 보는 중"을
판정했다면 배치 한 번에 몇 달 전에 보고 만 사람 전부가 접속자로 올라온다 — **아무도 안 보고 있을
때 가장 크게 틀린다.**

`watch_bucket.updated_at`은 클라이언트가 시청을 보고할 때만, 그것도 `now()`(서버 시각)로 갱신된다.
기기 시계가 틀어져 있어도 흔들리지 않는다(`client_updated_at`을 쓰지 않는 이유이기도 하다).

- **판정은 `watch_bucket`, 위치는 `learning_progress`.** 칸 번호의 최댓값은 *가장 멀리 간 지점*이라
  현재 위치가 아니다. 재생 위치는 같은 15초 주기에 함께 올라오는 `last_position_ms`가 답이다.
- **창은 60초** — 보고 주기(15초)의 네 배. 더 짧으면 보고 한 번을 놓친 사람이 깜빡이고, 더 길면
  나간 사람이 남아 "듣고 있다"고 잘못 말한다.
- **일시정지·창 닫기로 목록에서 빠지는 것은 의도한 동작이다.** 묻는 것이 "재생 중인 사람"이다.
  화면이 그 이유를 함께 적어 "0명"이 고장으로 읽히지 않게 한다.
- **강사 본인의 재생은 잡히지 않는다** — 애초에 기록하지 않는다(ADR-0063, 재시청 그래프 오염 방지).

## 결정 3 — 새 계측을 만들지 않았다

"지금 뭘 보는지"를 알려고 클라이언트에 하트비트를 새로 심고 전용 표에 쌓는 선택지가 있었지만
하지 않았다. **두 신호 모두 이미 서버에 도착하고 있었고 노출만 되지 않았다.** 새 하트비트는 이미
15초마다 오는 보고 위에 같은 뜻의 트래픽을 하나 더 얹는 것이고, "누가 언제 무엇을 봤나"를 담는
표를 새로 만드는 것은 보존 기간·열람 권한을 새로 정해야 하는 별개의 결정이다.

`admin` 모듈은 ADR-0089대로 **조합만** 한다. 새로 연 포트는 조회 두 개
(`LivePresenceDirectory.presentIn`, `LearningDirectory.findRecentWatchers`)와 이름 배치 조회
(`UserDirectory.findDisplayNames`)뿐이고, 도메인 모듈은 그대로다.

**이메일은 담지 않는다.** 누가 듣고 있는지는 표시 이름으로 충분하다(ADR-0089와 같은 규칙).
이름을 못 찾아도 **행은 남긴다** — 운영자가 보는 것은 인원이고, 이름 하나 때문에 숫자가 틀리면 안 된다.

## 결정 4 — 상세와 나눈 별도 엔드포인트다

`GET /api/admin/live-sessions/{sessionId}/viewers`

세션 상세(`/admin/live-sessions/{id}`)에 얹지 않았다. **수명이 다르기 때문이다** — 세션 상세는 거의
변하지 않지만 접속자는 초 단위로 바뀌어 화면이 10초마다 다시 받는다. 한 응답에 묶으면 접속자를
새로 받으려고 강의 제목·녹화 상태까지 매번 다시 조회하게 된다(ADR-0089의 "기존 응답을 넓히지
않는다"와 같은 이유).

없는 세션은 **404**(상세와 같은 규칙). 판정 창은 응답에 `recentWindowSeconds`로 함께 실어 화면이
서버와 **같은 기준**으로 설명하게 한다(`LiveSummary.stuckAfterHours`의 선례).

## 한계 — 단일 인스턴스 전제

접속자 집계는 메모리에 있다. 서버를 여러 대로 늘리면 목록이 인스턴스별로 쪼개진다. 다만 이것은
**SimpleBroker가 이미 깔고 있는 전제**이고(ADR-0019) 새로 생기는 제약이 아니다. 브로커를 외부
relay로 바꾸는 기존 과제와 함께 이 집계도 공유 저장소로 옮겨야 한다. 다시보기 시청자는 DB에서
오므로 이 한계와 무관하다.

## 검증

| 확인 | 방법 |
|---|---|
| 강사와 수강생을 갈라 말한다 | `AdminSessionViewerContractTest#the_live_list_tells_the_instructor_from_the_audience` |
| 탭 두 개는 한 명이다 | `#two_tabs_are_still_one_person` |
| 다른 세션 사람이 섞이지 않는다 | `#someone_in_another_session_does_not_show_up_here` |
| 어디를 보고 있는지 나온다 | `#a_recent_report_shows_where_the_viewer_is` |
| 보고가 끊기면 빠진다 | `#someone_who_stopped_reporting_drops_out` |
| **진도 배치가 시청으로 오인되지 않는다** | `#the_progress_settlement_batch_is_not_mistaken_for_watching` |
| 없는 세션은 404 | `#an_unknown_session_has_no_viewers` |
| 모듈 순환이 없다 | `ModularityTests` |
| 두 목록이 섞이지 않는다 | `AdminSessionDetailPage.test.tsx` |
| 강사가 없으면 그렇게 말한다 | 같은 파일 — 강사가 있으면 경고하지 않는 것까지 |
| 이름을 못 찾아도 행이 남는다 | 같은 파일 |
| **이 조회가 실패해도 상세는 그대로다** | 같은 파일 — 부가 정보 하나가 운영 화면을 막지 않는다 |
