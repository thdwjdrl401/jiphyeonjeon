# ADR-0075: 다시보기 AI 질의응답 — Spring 중계 개통(ADR-0047 §9 해소)

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-08-04
- **관련**: [0047](0047-live-ai-answer-sse-proxy.md)(라이브 AI 중계 — 이 결정이 §9를 대체한다),
  [0039](0039-replay-playback-api.md)(재생 시간축), [0052](0052-caption-segment-anchor-consumption.md)(확정 자막·STT 시작 앵커),
  [canola 0042](../canola/0042-replay-ai-caption-context-contract.md)(요구 계약),
  [jinwoo 0008](../jinwoo/0008-replay-rag-answer-v2-endpoint.md)·[0009](../jinwoo/0009-replay-v2-solo-merge-and-contract-test-deferral.md)(ai-api v2 구현 · Spring 계약 테스트 위임),
  [choinhoo 0015](../choinhoo/0015-recorded-lesson-replay-v2-rag-adapter.md)(업로드 녹화강의 — 같은 endpoint를 공유한다),
  `ai/ai-api/CONTRACT.md` §8
- **오너 경계**: BE(송정기) — 인가·세션 결정·자막 선별·중계 / AI — v2 endpoint(구현 완료, MR !301) / FE — 질문 UI·근거 탐색(이 MR에 포함)

## 맥락

다시보기 화면의 영실이는 **의도적으로 막혀 있었다**. ADR-0047 §9가 두 가지를 이유로 들었다.

1. **어느 세션인지 고를 규칙이 없다.** ai-api가 `sessionId`를 필수로 받고 자막 근거를 그 세션 범위로
   검증하는데, 레슨에는 라이브 세션이 여럿일 수 있다.
2. **시간 축이 다르다.** 다시보기 재생 위치는 세션 상대 ms([0039](0039-replay-playback-api.md))인데
   ai-api는 attempt-local `streamElapsedMs`를 요구한다. 라이브는 "최신 자막 행"이 곧 그 좌표라 변환이
   필요 없지만, 다시보기는 임의 시점이라 역변환 앵커가 필요했고 그 앵커가 없었다.

둘 다 지금은 해소됐다.

- **①은 애초에 규칙이 필요한 문제가 아니었다.** `VideoAsset.liveSessionId`가 있다 — 재생 중인 자산은
  세션 **하나**에서 나온 산출물이라 후보가 하나뿐이다. "규칙을 정한다"가 아니라 "자산에게 묻는다"가 답이다.
- **②는 [ADR-0052](0052-caption-segment-anchor-consumption.md)가 이미 풀어놨다.** `caption.stream.started`의
  `audioStartedAt`(그 attempt의 0이 절대 몇 시였나)을 영속하고 있어서, attempt-local 좌표를 세션 시간으로
  옮길 수 있다. 게다가 [canola ADR-0042](../canola/0042-replay-ai-caption-context-contract.md)가 변환
  **방향을 뒤집어** 문제를 더 작게 만들었다 — ai-api가 세션 시간을 되돌리는 게 아니라, Spring이 세션
  시간으로 변환한 자막을 실어 보내고 ai-api는 재조회하지 않는다.

ai-api의 `POST /internal/v2/rag/answers:stream`은 이미 머지됐다(MR !301). 남은 것은 Spring caller와 FE다.

## 결정

### 1. 공개 endpoint는 `POST /api/lessons/{lessonId}/ai/answers/stream` — **업로드 녹화강의와 공유한다**

> 이 절은 병합 과정에서 개정됐다. 같은 시기에 `feat/be/mp4`가 업로드 녹화강의용으로 **같은 경로**를
> 올렸고([choinhoo ADR-0015](../choinhoo/0015-recorded-lesson-replay-v2-rag-adapter.md)),
> 두 컨트롤러가 같은 매핑을 잡으면 Spring이 기동에 실패한다. 경로를 나누는 대신 **하나로 합쳤다.**

갈림길은 `lesson.deliveryType` 하나다 — 한 레슨은 `RECORDED`(업로드)이거나 `LIVE`이지 둘 다일 수
없으므로, "이 레슨에 어떤 자산이 있나" 뒤져 추측하지 않는다.

| deliveryType | 자막 출처 | 시간축 |
|---|---|---|
| `RECORDED` | `recorded_caption_segment` | 그 자체가 플레이어 축 |
| `LIVE` | `core.live_caption` | `audioStartedAt` 앵커를 적용해야 세션 축이 된다 |

두 갈래는 ai-api Replay v2 **같은 wire**로 나가고 SSE 중계도 같다. 다른 것은 자막 출처와, 답변을
기록하는지 여부뿐이다(LIVE만 라이브 질문과 같은 표에 쌓는다 — RECORDED에는 묶을 세션이 없다).

합치면서 중복 세 벌이 사라졌다: v2 어댑터(양쪽이 각자 만들던 것 → `ReplayRagAnswerCommand` 한 벌),
SSE 펌프(→ `RagAnswerRelay`), FE SSE 리더(→ `streamLessonAiAnswer`).

#### 원래 결정(레슨 스코프)

라이브는 세션 스코프(`/api/live-sessions/{sessionId}/...`)를 계속 쓴다. 두 경로를 나눈 이유는 **시간축이
다르기 때문**이지 취향이 아니다. 다시보기는 세션을 클라가 알 필요도, 골라서도 안 된다 — 레슨과 재생
위치만 주면 서버가 자산에서 세션을 찾는다.

경로가 `/stream`으로 끝나는 것은 계약이다(nginx `location ~ ^/api/.+/stream$`만 `proxy_buffering off`).

요청 body는 **둘뿐**이다:

```json
{ "question": "여기서 말한 컨슈머 그룹이 뭐야?", "playbackSessionMs": 735000 }
```

`sessionId`·`curriculumId`·자막·`requestId`는 전부 서버가 채운다. 클라가 세션이나 커리큘럼을 고를 수
있으면 수강하지 않은 강의의 근거를 열람할 수 있다.

`playbackSessionMs`는 플레이어 시각이 아니라 **세션 상대 시간**이다(FE가 `mediaTimeMs +
source.availableFromMs`로 계산). 라이브 도중 합류하면 두 값이 달라서, 미디어 시각을 그대로 보내면
자막 근거가 통째로 어긋난다. 없거나 음수면 400 — 0으로 때려 넣지 않는다. 어느 대목을 물었는지 모르는
채 답하는 것보다 거절이 낫다.

### 2. 인가는 **재생 게이트를 그대로 공유**한다 — "볼 수 있으면 물어볼 수 있다"

`ReplayPlaybackService.requirePlaybackContext`를 같은 패키지에서 재사용한다(복제 금지). 결과적으로:

| 상황 | 응답 |
|---|---|
| 소유 강사 | 게시 전에도 가능(검수) |
| 활성 수강생 + 게시된 다시보기 | 가능 |
| 미수강 | 403 `ENROLLMENT_REQUIRED` |
| 학생 + 미게시 | 404 `REPLAY_NOT_FOUND`(존재 자체를 숨긴다) |
| 자산 미준비 | 409 `REPLAY_NOT_READY` |
| 송출 준비 중 | 409 `RECORDING_STARTING` |

게이트를 복제하면 언젠가 한쪽만 고쳐진다. 재생과 질문의 접근 조건이 갈리는 순간 "볼 수는 있는데 못
물어보는" 화면이 생기고, 그건 사용자가 이해할 수 없는 상태다.

인가 실패 시 **ai-api를 부르지 않는다** — 비용도 비용이지만 근거가 새면 안 된다.

### 3. 자막 문맥의 시간축 변환은 live 모듈이 한다

`ReplayAiContextService`가 유일한 변환 지점이다:

```
attemptStartSessionMs = audioStartedAt − liveSession.startedAt
captionStartSessionMs = attemptStartSessionMs + startStreamElapsedMs
```

이건 CONTRACT §3-4가 금지한 "앵커 없는 `streamElapsedMs`→세션ms 환산"이 **아니다**. 금지된 것은 앵커
없이 짐작하는 것이고, 여기서는 실제 앵커 행을 읽어 적용한다. **앵커가 없는 attempt의 발화는 버린다** —
시간을 지어내느니 근거에서 빼는 편이 낫다.

선별 규칙(순수 함수 `ReplayCaptionWindow`, 단위 테스트로 고정):

- `caption.segment.final`만. 질문 시점 **뒤에 시작한** 발화는 제외 — 아직 듣지 않은 말을 근거로 삼지 않는다.
- 질문 시점을 품은 발화는 **통째로** 포함(반 토막은 근거가 못 된다).
- 그 발화 시작에서 뒤로 30초. 질문이 발화 사이 공백에 떨어지면 질문 시점 기준 30초.
- 상한 20개 · 6,000자. 넘으면 **오래된 것부터** 버린다(질문 시점에 가까운 말이 더 값지다).
- 자막이 하나도 없어도 **실패가 아니다** — PPTX 근거만으로 답한다.

### 4. 모듈 경계: 중계 펌프를 aiintegration으로 올린다

다시보기 endpoint는 재생 인가가 필요해서 **video 모듈**에 산다. 그런데 중계 펌프·자막·기록은 live에
있었고, `video → live.api`는 되지만 역방향은 순환이라 그대로는 쓸 수 없었다.

그래서 라이브·다시보기가 **공유할 것만** aiintegration(양쪽이 이미 의존)으로 올렸다.

- `RagAnswerRelay` — SSE 펌프. 이벤트 무변환·terminal 정확히 하나·취소 시 업스트림 닫기는 두 경로가
  완전히 같다. live는 이제 여기에 위임한다(동작 변화 없음, 기존 계약 테스트가 지킨다).
- `RagAnswerObserver` — 곁다리 소비자(기록) 인터페이스. 덕분에 aiintegration이 live의 저장소를 모른다.
- `RagAnswerUpstreamErrors` — 업스트림 실패 → 상태코드. 두 경로가 **같은 코드**를 내보내야 FE 분기가 하나다.

live는 `ReplayAiContextSource`(자막 문맥)와 `AiAnswerJournal`(기록)을 `live.api`로 공개한다.

### 5. 답변은 라이브 질문과 **같은 표**에 남는다

`live_ai_answer`에 그대로 쌓고 세션 키를 공유한다. 한 세션에서 물어본 것은 라이브에서 물었든
다시보기에서 물었든 사용자에겐 한 줄기다. 기록 조회도 기존
`GET /api/live-sessions/{sessionId}/ai/answers`를 그대로 쓴다 — 새 엔드포인트를 만들면 FE가 화면마다
다른 이력을 합쳐야 한다.

### 6. FE는 `liveSessionService.askReplayAi`가 소유한다 — `replayService`가 아니다

기존 `replayService.askReplayAi` 501 스텁은 **지웠다**. 스트림 읽기(fetch + ReadableStream), 이벤트 매핑,
CSRF·취소 처리가 전부 `httpLiveSessionService`에 있는데 스텁만 다른 파일에 두면 같은 대화가 두 서비스로
갈린다. 기록 조회도 세션 경로를 공유하므로 한 곳에 두는 편이 맞다. 스트림 본문은
`streamAiAnswer(url, body, options)`로 뽑아 라이브·다시보기가 같은 코드를 쓴다.

화면이 보내는 위치는 플레이어가 `toSessionMs(mediaTime, source.availableFromMs)`로 계산해 둔
`positionMs`다. **자막 근거는 이제 눌러서 이동할 수 있다** — v2 근거가 세션-ms 축이라 그대로 seek이
걸린다. 라이브(v1) 근거는 attempt-local 축이라 표시 전용 그대로이고, `AiEvidenceList`가 두 모양을
필드 존재로 구분해 안내 문구도 이동 불가 근거가 있을 때만 띄운다.

### 7. 오류 응답은 `ErrorResponses`로 Content-Type을 preset한다

이 endpoint는 `Accept: text/event-stream`으로 호출된다. 오류 봉투에 미디어 타입을 명시하지 않으면
Spring이 협상에 실패해 **원래 예외가 그대로 새어나간다**(500). ADR-0047에서 라이브가 겪은 문제라
새 advice(`ReplayAiExceptionHandler`)는 처음부터 전부 preset한다.

## 대안

| 대안 | 기각 이유 |
|---|---|
| 라이브 endpoint에 `positionMs`를 옵션으로 추가 | 한 endpoint가 두 시간축을 갖게 된다. ai-api도 v1/v2를 나눈 이유가 같다 — 라이브의 시간 의미를 건드리지 않기 위해서다 |
| video가 live의 자막 테이블을 직접 읽기 | 모듈 경계 위반(Modulith가 잡는다). 변환에 필요한 앵커 해석까지 video가 떠안는다 |
| 세션 시간 변환을 ai-api에 맡기기 | canola ADR-0042가 이미 반대로 정했다. agent는 세션 시작 시각을 모르고, 앵커 행을 가진 쪽은 우리다 |
| 자막 선별을 SQL로 좁히기 | 좁힐 좌표가 행에 없다 — 세션 ms는 앵커를 적용해야 나오고 앵커는 다른 type의 행에 있다. 세션 하나치(확정 발화 1~2천 행)를 읽고 메모리에서 창을 잡는다 |
| 다시보기 답변을 별도 표에 저장 | 사용자에겐 한 대화다. 표가 갈리면 화면이 둘을 합쳐야 하고 순서가 어긋난다 |

## 결과

**얻는 것**

- 다시보기에서 질문이 실제로 된다. 근거에 자막 `excerpt`가 실려 FE가 그 시점으로 이동시킬 수 있다.
- 라이브·다시보기가 중계 코드를 공유해 한쪽만 고쳐지는 회귀가 사라진다.
- ADR-0047 §9의 보류가 닫힌다.

**감수하는 것**

- **비용 상한이 없다.** 라이브는 세션 길이가 암묵적 상한이었지만 다시보기는 아무 때나 몇 번이든 물을 수
  있다. 지금은 rate limit을 걸지 않았다 — 데모 규모에서 과한 방어이고, 필요해지면 여기에 429를 추가한다.
- **자막 선별이 세션 전체를 읽는다.** 2시간 강의도 확정 발화는 1~2천 행이라 인덱스가 듣지만, 세션이
  길어지면 occurredAt 범위로 미리 좁히는 최적화가 필요하다.
- **`playbackMs`를 필수로 조였다.** 합치기 전 공유 DTO는 primitive `long`이라 누락이 조용히 0이 되어
  "강의 맨 앞에서 물었다"로 답했다. 어느 대목을 물었는지 모르는 채 답하느니 거절이 낫다고 보고
  `@NotNull Long`으로 바꿨다 — 양쪽 FE는 이미 항상 보내고 있어 실사용 영향은 없다.
- **ai-api가 v2 필수 필드를 늘리면 우리 테스트는 통과한 채 운영이 400을 맞는다.** v1에서 `curriculumId`로
  실제 겪었다(2026-07-30, 이틀). 정본은 `ai/ai-api/CONTRACT.md` §8이고 그쪽이 바뀌면 여기도 같이 고친다.

## 검증

`ReplayAiAnswerContractTest` 15건 — v2 경로·raw body HMAC·최상위 7필드·`context.mode=REPLAY`·앵커를
적용한 세션 ms 변환·앵커 없는 발화 제외·질문 이후 발화 제외·SSE 무변환 중계·terminal 없는 종료·재생과
동일한 인가(강사 게시 전 가능/미수강 403/학생 미게시 404)·업스트림 503·409·401 매핑·입력 검증.

`ReplayCaptionWindowTest` 8건 — 선별 규칙(미래 제외·포함 발화 보존·30초 창·공백 fallback·개수/길이
상한·단일 초과 발화 보존·빈 결과).

`LessonAiAnswerServiceTest` 3건 — 분기가 맞는지. `RECORDED`면 라이브 자막을 건드리지 않고, `LIVE`면
`askedBy`를 넘겨 답변이 기록되며, 없는 레슨은 어느 갈래도 돌기 전에 404로 은닉된다. **잘못 갈리면 다른
강의의 자막을 근거로 답한다** — 그래서 단정으로 적는다.

`LessonAiAnswerControllerContractTest` 3건 — 공개 입력이 `lessonId`·`question`·`playbackMs`뿐이고,
음수·**누락** 위치를 서비스 호출 전에 거절한다.

FE `LiveAiQuestion.test.tsx` — 다시보기 패널이 레슨 스코프 + 재생 위치로 질문하고 스트리밍 답변을
그린다(예전에는 "질문할 수 없다"를 단정하던 테스트다).

백엔드 전체·프론트 941건 통과. 중계 펌프를 aiintegration으로 옮긴 것과 녹화강의 서비스가 그것을
쓰도록 바꾼 것은 기존 `LiveAiAnswerContractTest`·`RecordedAiAnswerServiceTest`가 지킨다.

> **덤으로 고친 것**: 두 AI 계약 테스트가 무작위로 깨지고 있었다. 원인은 (1) 목 ai-api의 기본 executor가
> 단일 스레드라 SSE 응답이 다음 요청을 막고, (2) MockMvc 기본 출력 핸들러가 릴레이 스레드와 응답 헤더를
> 두고 경합한 것이다. 각각 `setExecutor(cachedThreadPool)`와 `print = NONE`으로 닫았다.
