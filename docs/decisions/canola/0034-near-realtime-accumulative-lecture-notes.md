# ADR-0034: caption delta로 축적형 강의 노트 MVP를 먼저 검증

- **상태**: 채택
- **일자**: 2026-07-29
- **관련**: [ADR-0022](0022-realtime-caption-stream-retention.md),
  [ADR-0025](0025-realtime-agent-spring-handoff-contract.md),
  [공유 계약](../../CONTRACT.md)

## 목적

실시간 자막과 별도로, 강의 내용을 주제별 Markdown 노트로 빠르게 축적할 수 있는지 먼저 확인한다.
처음부터 최종 계약·다중 인스턴스·Spring 영속·Frontend까지 만들지 않는다. 현재 Redis caption delta를
그대로 재사용해 **주제 분리 품질, 요점 품질, 체감 지연과 호출 비용**을 보는 AI·Redis MVP를 만든다.

```text
ai:captions:live
  → ai-live-notes-mvp-v1 group
  → 15~40초 text window
  → LLM 구조화 결과
  → 주제별 누적 Markdown
  → Redis MVP append event Stream
```

AI→Redis event payload는 Backend가 구현 전에 의존 조건을 검토할 수 있도록 공유 계약으로 먼저 고정한다.
Spring REST·WebSocket, core read model, topic accordion은 MVP 결과가 만족스러울 때 구현한다. 녹화본 기반
다시보기 교정 자막은 이번 MVP 범위에 포함하지 않고 별도 결정으로 다룬다.

## MVP 결정

### 1. 기존 Stream을 별도 group으로 읽는다

입력 Stream은 현재 구현된 전역 `ai:captions:live`를 그대로 사용한다.

```text
ai:captions:live
├─ ai-rag-live-v1
└─ ai-live-notes-mvp-v1
```

같은 group을 쓰면 RAG와 note consumer가 entry를 나눠 가지므로 반드시 별도 group을 사용한다. MVP는
ai-api 인스턴스 하나와 consumer 하나만 운용한다. consumer name은 `${instanceId}:live-notes-mvp`다.
group은 최초 생성할 때 `0-0`에서 시작해 Redis Stream에 아직 보존된 과거 entry부터 모두 읽는다.
재연결은 group을 다시 만들지 않고 기존 group position과 같은 consumer의 pending entry를 이어서 읽는다.
다른 consumer가 남긴 pending entry 회수는 다중 인스턴스와 `XAUTOCLAIM`을 다룰 때 함께 결정한다.

`caption.delta`를 `(sessionId, sttSessionId, sequence)` 순으로 붙이고 `eventId`와 sequence로 중복을
제거한다. sequence가 `10` 다음 `12`처럼 건너뛰면 누락을 metric과 log로 기록하되 `12` 이후 delta는
계속 처리한다. MVP 출력 event에 별도 `incomplete` 필드는 추가하지 않는다. handler가 자막과 미처리 작업을
Redis session checkpoint에 저장한 뒤 ACK한다. ACK는 노트 생성 완료가 아니라 **재시작해도 다시 처리할 수
있는 durable acceptance**를 뜻한다.

새 `sttSessionId`가 시작되면 이전 window에 text가 있는 한 최소 시간·글자 조건과 무관하게 모두 flush하고
새 attempt로 전환한다. `caption.stream.completed`가 와도 같은 방식으로 남은 text를 모두 처리하고 note를
완료 상태로 만든다.

### 2. 시간과 문장부호를 함께 사용해 자른다

공백은 문장 경계로 사용하지 않는다. delta의 leading space를 포함해 text를 순서대로 그대로 붙인다.
온점도 필수 조건이 아니라 자연스러운 cut 지점을 고르는 보조 조건이다.

| 정책 | MVP 초기값 |
|---|---:|
| 최소 window | 15초이면서 80자 이상 |
| 목표 window | 25초 |
| 강제 flush 임계값 | 40초 또는 400자 |
| 강한 종결 | `.`, `?`, `!`, `。`, `？`, `！`, 줄바꿈 |
| 이전 문맥 | 직전 window 마지막 1~2문장 |

동작은 다음으로 단순화한다.

1. 15초·80자 전에는 계속 축적한다.
2. 15~25초에 강한 종결로 끝나면 LLM에 보낸다.
3. 25초를 넘으면 다음 delta에서 문장부호와 무관하게 보낸다.
4. 40초 또는 400자에 도달하면 강제로 보낸다.
5. stream completion에서는 남은 text를 모두 보낸다.

delta 하나는 sequence 중복 제거의 원자 단위이므로 400자 경계에서 text를 다시 쪼개지 않는다. 따라서
400자는 결과 text의 절대 상한이 아니라 현재 delta 전체를 붙인 직후 flush하는 임계값이며, 단일 delta가
크면 window도 400자를 초과할 수 있다.

현재 `streamElapsedMs`는 attempt-local 시계이므로 window 길이 계산에만 사용한다. 이를 세션 상대
`startMs/endMs`로 저장하거나 FE seek에 사용하지 않는다.

### 3. LLM은 세 가지 내부 판단만 한다

MVP에서는 복잡한 candidate·subtopic·return 상태를 만들지 않는다. 모델은 현재 topic을 계속할지 새
topic을 시작할지, 노트로 남길 내용이 아닌지를 판단한다.

```json
{
  "action": "APPEND",
  "topicTitle": "Refresh Token의 역할",
  "keyPoints": [
    "Access Token 만료 뒤 재발급에 사용한다."
  ]
}
```

허용값과 제한은 다음과 같다. 이 값은 AI 내부 모델 결과이며 Redis wire의 `topicAction`과 구분한다.

- `action`: `IGNORE|APPEND|START_NEW`
- `IGNORE`: `topicTitle=null`, `keyPoints=[]`; operation만 완료하고 event·`chunkSequence`를 만들지 않음
- `APPEND`: 외부 event에서는 `topicAction=CONTINUE`로 변환
- `topicTitle`: 최대 80자
- `keyPoints`: `APPEND|START_NEW`에서 호출당 1~3개, 각 300자
- 정의·사례·강조 여부는 만들지 않고 말한 내용의 요점만 생성
- 강의 text는 신뢰하지 않는 데이터로 전달하고 tool은 사용하지 않음

현재 `OPEN` topic의 title·points와 직전 topic title, 이전 문맥, 새 window만 prompt에 넣는다. 전체
강의 원문이나 전체 Markdown을 매번 다시 보내지 않는다.

같은 세션의 모델 호출은 하나만 실행한다. 호출 중 새 window가 생기면 요청을 여러 개 쌓지 않고 다음
window 하나로 합친다. JSON parse·validation 실패나 timeout이 process 전체를 중단시키거나 기존 note를
훼손하지 않게만 방어한다. retry, 실패 window 재처리, completion 중 실패 상태 같은 구체적인 복구 정책은
MVP 결과를 본 뒤 결정한다.

첫 구현은 ai-api의 GMS OpenAI-compatible client를 사용하되 RAG 답변 adapter와는 별도
`LectureNoteModel`로 둔다. JSON mode 지원 여부와 실제 latency가 MVP에서 확인할 첫 항목이다.

### 4. topic은 즉시 축적한다

- 첫 `APPEND|START_NEW` 결과로 첫 topic을 만든다.
- `APPEND`면 현재 topic에 새 point를 추가한다.
- `START_NEW`면 현재 topic을 닫고 새 topic을 즉시 만든다.
- Unicode, 연속 공백, 끝 문장부호, 영문 대소문자만 가볍게 정규화해 같은 point를 제거한다.
- 잘못 나뉜 topic의 자동 합치기·되돌리기는 MVP에 넣지 않는다.

구조화 topic이 정본이고 Markdown은 애플리케이션이 다음처럼 만든다.

```md
## Refresh Token의 역할

- Access Token 만료 뒤 재발급에 사용한다.
- 서버에서 별도로 폐기할 수 있어야 한다.
```

결과는 Markdown text로 만들며 heading, unordered list, bold, inline code만 허용한다. 표준 Markdown에는
접기·펼치기 문법이 없고 `<details>`는 raw HTML이므로 MVP 출력에 넣지 않는다. topic accordion은 추후
Frontend가 구조화 `topics`를 사용해 제공한다. raw HTML·image·외부 link는 만들지 않는다.

### 5. 새로 추가된 노트 조각만 Redis Stream에 싣는다

실시간으로 노트가 쌓이는 흐름과 Backend의 누적 저장 책임을 분리하기 위해 매 모델 결과의 전체 snapshot이
아니라 실제로 새로 추가된 조각만 발행한다. AI 내부 reducer는 다음 모델 요청의 문맥과 중복 제거를 위해
현재 topic 상태를 계속 보관하지만, Redis에는 과거 Markdown을 반복해서 보내지 않는다.

```text
XADD ai:lecture-notes:mvp MAXLEN ~ 10000 ...
```

새 요점이 생기면 다음 event를 발행한다. 첫 topic 또는 `START_NEW`는 heading과 요점을 함께 보내고,
`CONTINUE`는 새 bullet만 `markdownFragment`에 담는다. 완전히 같은 요점만 나온 호출은 event와
`chunkSequence`를 만들지 않는다.

```json
{
  "contractVersion": "1",
  "type": "lecture.note.chunk.appended",
  "eventId": "evt-...",
  "sessionId": "...",
  "lessonId": "...",
  "sttSessionId": "...",
  "chunkSequence": "4",
  "latestSttSequence": "128",
  "topicAction": "CONTINUE",
  "topicId": "topic-1",
  "topicTitle": "Refresh Token의 역할",
  "keyPoints": ["Access Token 만료 뒤 재발급에 사용한다."],
  "markdownFragment": "- Access Token 만료 뒤 재발급에 사용한다.",
  "occurredAt": "2026-07-29T12:00:30+09:00"
}
```

caption 수집이 끝나면 먼저 `lecture.note.capture.completed`를 발행한다. 여기에는 `lastChunkSequence`,
`lastSttSequence`, `reason`만 담는다. 그 뒤 종료 후 정제 결과는 live append와 섞지 않고 별도
`lecture.note.refined.snapshot` 전체 snapshot으로 한 번 발행한다. `chunkSequence`는 세션별 live 추가 조각
순번이며 `1`부터 증가하고 refined snapshot은 이 값을 증가시키지 않는다. 재전송 event는 같은 `eventId`와
payload를 유지한다.

Redis field 값은 STT event와 마찬가지로 모두 string으로 싣고, `keyPoints`만 compact JSON 배열 문자열로
직렬화한다. AI event에는 `noteVersion`을 싣지 않는다. Backend가 조각을 누적 저장한 횟수가 필요하면
Backend read model의 `noteVersion`으로 별도 관리한다.

Redis key와 event payload·순서·멱등·ACK 규칙은 [공유 계약 §3-4a](../../CONTRACT.md#3-4a-ai-api--application-redis-실시간-강의-노트-stream--ai-producer-구현-spring-consumer-미구현)로
고정한다. Spring과 Frontend 구현은 아직 이 ADR의 범위 밖이다. Backend 연동 시에는 event를 순서대로 누적
저장하고, REST 재접속 응답은 Backend가 만든 전체 노트를 반환하며, 실시간 WebSocket에는 새 조각만 전달한다.
Spring은 별도 consumer group을 사용하고 DB 반영 뒤 ACK하며, `eventId` 중복과 이미 반영한
`chunkSequence`는 무시한다. 기대 순번보다 큰 조각은 조용히 이어 붙이지 않고 누락으로 기록하되 복구
정책은 다음 단계에서 확정한다.

### 6. 기준선 구현 범위와 예상 문제

기준선은 AI publisher와 내부 event model, Redis Stream 직렬화까지 구현했다. 후속 단계에서 단일 ai-api
프로세스의 checkpoint·restore와 outbox 원자 발행을 추가했다. Spring consumer, DB, REST, WebSocket은
만들지 않는다. 또한 라이브 중 이미 발행한 조각은 수정·병합·삭제하지 않고 새 조각만 추가한다.

남은 문제와 제한은 다음과 같다.

- Redis retention 밖의 event를 놓치면 append event만으로 전체 노트를 재구성할 수 없다. Backend 영속화와
  재동기화용 전체 조회 또는 checkpoint는 연동 단계에서 결정한다.
- 라이브 중 잘못 나뉜 topic을 고치거나 이전 요점을 수정하지 않는다. 라이브는 append-only로 제한하고,
  강의 종료 후 별도 refined snapshot에서만 merge/split·제목·중복을 정제한다.
- checkpoint 저장 뒤 caption을 ACK하므로 모델 호출이나 결과 발행 도중 프로세스가 종료돼도 window와
  발행 대기 event를 재시작 후 복원한다. 모델 자체 실패의 retry 횟수·backoff·최종 실패 상태는 별도다.
- 여러 ai-api replica가 같은 세션을 처리하면 순번 충돌이 생길 수 있다. 현재는 단일 replica만 허용한다.

## 구현 순서와 단계별 제한

전체 구조를 빠르게 확인할 수 있도록 아래 단계를 독립 커밋으로 연결하고, 자동 테스트와 리뷰는
1~6단계 구조를 만든 뒤 한 번에 수행한다. 실제 Redis·GMS 동작은 7단계 EC2 실험에서 별도로 검증한다.

1. **순수 window 상태 머신**: Redis·GMS·async task 없이 delta 순서, 중복·gap, 15/25/40초와
   80/400자 경계, 문장부호, attempt 전환, completion flush만 구현한다.
2. **note reducer와 Markdown renderer**: `IGNORE|APPEND|START_NEW`, key point 중복 제거, `chunkSequence`,
   제한된 Markdown 생성을 순수 로직으로 구현한다.
3. **application orchestration**: `LectureNoteModel`과 state store를 port로 두고 fake 구현으로 세션별
   단일 호출과 호출 중 window 병합을 검증한다.
4. **Redis 결과 adapter**: 추가 조각·수집 완료 event와 결과 Stream `MAXLEN`을 구현하고 Redis integration
   test를 추가한다.
5. **GMS adapter**: RAG adapter와 분리된 `LectureNoteModel`을 구현하고 구조화 JSON 지원 여부, latency,
   호출 수를 확인한다.
6. **별도 caption consumer와 lifecycle**: `ai-live-notes-mvp-v1` group을 ai-api lifecycle에 연결하고
   RAG group과 독립적으로 같은 entry를 받는지 검증한다. MVP는 모든 실행 환경에서 이 consumer를
   시작하며 별도 enable 환경변수를 두지 않는다.
7. **30분 강의 실험**: Redis 결과와 metric을 관찰해 품질·지연·비용을 기록한 뒤 후속 범위를 결정한다.

현재 1~6단계 구현과 자동 테스트까지 완료했다. 4단계 결과 형식은 전체 snapshot에서 append event로
변경했고, 후속 1~3단계의 단일 프로세스 재시작 복구, 판단 품질, 종료 후 refined snapshot도 구현했다.
Spring, Frontend, DB, HTTP API는 여전히 범위 밖이다. 다음 작업은 EC2 단일 ai-api replica에서 7단계
30분 강의 실험을 수행하는 것이다.

## 재시작 복구와 품질 고도화 단계

기준선 구현 뒤 다음 순서로 확장한다. 한 단계에서 다음 단계의 문제까지 미리 해결하지 않는다.

### 1. 단일 ai-api 프로세스 재시작 복구

세션별 상태는 `ai:lecture-notes:mvp:state:{sessionId}`에 저장하고,
`ai:lecture-notes:mvp:active-sessions` Set은 시작 시 복원할 checkpoint를 찾는 색인으로 사용한다.
checkpoint에는 window accumulator, 현재 note와 `chunkSequence`, 대기·처리 중 batch, 완료 입력과
발행 전 outbox를 둔다. 내부 `operationId`는 입력 window 묶음의 처리 단위이며 외부
`chunkSequence`와 별개다. 중복 결과처럼 출력 event가 없는 작업도 operation만 완료하고 순번은 만들지
않는다.

처리 경계는 다음과 같다.

1. caption entry를 accumulator와 pending batch에 반영한다.
2. session checkpoint를 저장한 뒤 caption handler를 반환하고 consumer가 ACK한다.
3. 모델 호출 전 pending을 in-flight로 옮긴 checkpoint를 저장한다.
4. 모델 결과로 만들 event의 `eventId`·payload·시각을 outbox에 그대로 저장한다.
5. Redis transaction으로 결과 Stream `XADD`와 outbox를 비운 다음 checkpoint 저장을 원자화한다.
6. 재시작하면 active session을 읽고 outbox, in-flight, pending 순서로 이어서 처리한다.

completion도 마지막 window 결과를 먼저 확정한 뒤 완료 event를 발행한다. caption completion의 ACK 여부와
노트 완료 여부가 모두 확인된 session만 active index에서 제거한다. 이번 단계는 Redis가 정상이라는 전제의
**프로세스 비정상 종료·재시작**만 보장한다. Redis 자체 장애 내구성, AOF 정책, 여러 replica의 session
lease·fencing, 다른 consumer의 pending 회수(`XAUTOCLAIM`)는 다음 결정으로 미룬다.

재시작한 고정 consumer는 자기 pending entry를 먼저 모두 재처리한다. 이 drain 뒤에도
`completed=true`, `completionAcked=false`인 checkpoint가 남으면 이전 프로세스가 XACK을 성공시키고
checkpoint를 갱신하기 전에 종료된 경계로 보고 ACK 완료를 확정한다. 다른 consumer가 가진 pending은 이
판단 대상이 아니며, 이 복구 규칙은 단일 replica와 고정 consumer name 전제에 한정한다.

복구 테스트는 checkpoint 전·후, caption ACK 전·후, 모델 호출 전·후, outbox 저장 후, 결과 transaction
후 경계를 고정한다. 재처리 시 같은 출력 event가 중복 발행되지 않고 partial text, topic,
`chunkSequence`, completion 순서가 유지되는지를 검증한다.

### 2. 라이브 노트 판단 품질

복구 기반을 고정한 다음 모델의 내부 판단을 `IGNORE|APPEND|START_NEW`로 변경했다. 외부 append event의
`topicAction` 계약은 그대로 두고 `APPEND`만 `CONTINUE`로 변환한다. `IGNORE`는 operation만 완료하며 빈
event와 `chunkSequence`를 만들지 않는다.

prompt v2는 반복·잡음·미완성 발화를 `IGNORE`, 같은 개념의 설명·예시를 `APPEND`, 독립적으로 이름 붙일
수 있는 새 개념만 `START_NEW`로 판단하게 구현했다. 첫 구현은 Unicode·공백·문장부호 수준의 가벼운 중복
정규화까지만 사용하며 embedding, confidence, 자동 topic merge/split은 넣지 않는다.

8개 고정 한국어 강의 샘플과 v1/v2 실행 도구를 추가했다. 2026-07-30 실제 GMS A/B에서 v1은 유효 응답
7/8·실질 action 일치 5/8, v2는 유효 응답 8/8·실질 action 일치 8/8이었다. v2는 반복·미완성·운영 안내를
모두 `IGNORE`했고 유효 내용을 무시하지 않았다. 현재 topic이 없는 첫 결과의 `APPEND|START_NEW`는 같은 첫
topic을 만들기 때문에 과분할로 세지 않는다. 현재 topic에서 실제 과분할이 0건이므로 한-window topic 전환
확인은 추가하지 않고 라이브 지연을 늘리지 않는다. 상세 실행법과 표는
[ai-api scripts](../../../ai/ai-api/scripts/README.md)에 기록한다.

### 3. 종료 후 refined snapshot

라이브 출력은 append-only 초안으로 유지한다. capture 완료 event를 확정한 뒤 현재 구조화 draft topic만
GMS에 한 번 전달해 topic merge/split, 제목 교정, 중복 제거를 수행한다. raw caption 전체, 녹화 HLS, 자료
RAG는 다시 넣지 않는다.

결과는 `lecture.note.refined.snapshot`으로 같은 Redis Stream에 발행한다. event에는
`sourceLastChunkSequence`, 전체 구조화 `topics`, 여기서 결정론적으로 만든 `markdownSnapshot`을 담는다.
refined topic id는 `refined-topic-{n}`의 별도 공간을 사용하고 live `chunkSequence`를 늘리거나 과거 append
event를 수정하지 않는다. Backend는 live draft와 refined read model을 구분해야 한다.

정제 호출 전 pending checkpoint와 결과 outbox를 저장하며 snapshot `XADD`도 다음 checkpoint와 원자화한다.
따라서 snapshot 발행 도중 프로세스가 종료되면 같은 event를 복원한다. 정제 모델의 bounded retry·backoff,
최종 실패 상태, 강사 검수·게시, Spring/DB/Frontend 반영은 아직 범위 밖이다. 정제할 live topic이 하나도
없으면 모델과 snapshot 발행을 생략하고 capture 완료만 유지한다. 2026-07-30 고정 draft의 실제 GMS
smoke에서 두 ACK topic을 하나로 합친 유효 구조화 JSON 응답을 확인했다.

정제 모델 호출이나 결과 발행이 실패한 현재 프로세스는 즉시 반복 호출하지 않는다. checkpoint의
`refinementPending` 또는 outbox를 유지하고 ai-api 재시작 때 이어서 처리한다. 따라서 재시작 없는
same-process retry, 최대 시도 횟수와 backoff, 장기 실패 세션 정리는 이번 단계에서 보장하지 않는다.

## 2026-08-03 실험 결과에 따른 활성 topic 갱신 전환

> **상태**: 후속 구현 방향 채택, 순수 domain prototype 반영, wire 계약 반영 전. 이 절의 contract v2가
> 구현되기 전까지 실제 wire는 위의 `lecture.note.chunk.appended` contract v1을 유지한다.

실제 출력에서는 15~40초 window마다 최대 3개의 짧은 `keyPoints`를 만들고 이를 append-only bullet로
렌더링하면서, 설명이 짧게 끊기고 bullet 수만 계속 늘어나는 문제가 확인됐다. 종료 후 정제도 이미 bullet로
압축된 `draftTopics`만 받으므로 설명의 흐름과 사실 사이 관계를 충분히 복원하지 못한다. window를 단순히
길게 늘리면 첫 노트와 갱신 지연만 커지고, append-only 출력이라는 원인은 남는다.

따라서 caption window는 topic 판단과 새 정보 수집 단위로 유지하되, 사용자에게 보이는 노트의 갱신 단위는
**현재 활성 topic 전체**로 바꾼다. 라이브 중에는 전체 강의 노트를 매 호출마다 재생성하지 않고 현재 topic만
수정한다. 새 topic이 시작될 때는 같은 모델 호출에서 직전 topic을 한 번 정리해 확정하고 새 활성 topic을
만든다.

```text
caption window
  → IGNORE: 상태와 event 변경 없음
  → UPDATE_CURRENT: 현재 ACTIVE topic 내용 교체
  → START_NEW: 현재 topic 정리·FINALIZED + 새 ACTIVE topic 생성
  → capture completed: 마지막 ACTIVE topic 확정 + 종료 후 전체 정제
```

### 1. 모델 호출과 비용 경계

모델 입력에는 전체 강의 원문이나 확정된 전체 topic 목록을 넣지 않는다. 다음 세 부분만 사용한다.

- 현재 `ACTIVE` topic의 제한된 구조화 내용: title, overview, typed items
- 직전 window의 마지막 1~2문장 문맥
- 이번에 새로 들어온 caption window 묶음

현재 topic의 `overview`와 `items`가 누적 지식의 working memory 역할을 한다. 모델은 기존 사실을 보존하면서
새 window의 설명을 반영해 현재 topic 전체를 다시 작성한다. prompt 크기는 topic 하나의 구조화 내용으로
제한하며, 이미 `FINALIZED`된 과거 topic과 전체 raw caption은 다시 보내지 않는다.

정상 응답 기준 한 pending batch당 GMS 호출은 한 번이다. `START_NEW`에서도 이전 topic 정리 호출과 새 topic
생성 호출을 분리하지 않고 한 응답으로 함께 받는다. schema validation 실패의 bounded retry는 허용하되 별도
호출로 계측한다. 전체 노트 재생성, 확정 topic의 라이브 재검토, 전체 강의 원문 재전송은 하지 않는다.

### 2. 모델 결과와 topic 상태

내부 판단은 append 의미가 모호해지지 않도록 `IGNORE|UPDATE_CURRENT|START_NEW`로 바꾼다. 모델은 ID, revision,
status를 정하지 않고 topic 내용만 반환하며, 이 세 값은 application service가 관리한다.

```json
{
  "action": "START_NEW",
  "currentTopic": {
    "topicTitle": "Redis Consumer Group",
    "overview": "Consumer Group은 여러 소비자가 하나의 Stream을 나누어 처리하도록 함. 처리 완료 여부는 ACK를 기준으로 추적함.",
    "items": [
      {
        "type": "DEFINITION",
        "label": "ACK",
        "content": "상태 저장과 결과 발행까지 완료됐음을 확인하는 신호임"
      },
      {
        "type": "MECHANISM",
        "label": "메시지 분배",
        "content": "각 메시지는 그룹 안의 한 소비자에게 전달됨"
      }
    ]
  },
  "newTopic": {
    "topicTitle": "Pending 메시지 복구",
    "overview": "ACK되지 않은 메시지는 Pending 상태로 남아 재처리 대상이 됨.",
    "items": [
      {
        "type": "FACT",
        "label": "Pending 상태",
        "content": "ACK되지 않은 메시지가 Pending 목록에 남음"
      }
    ]
  }
}
```

결과 제약은 다음과 같다.

- `IGNORE`: `currentTopic=null`, `newTopic=null`
- `UPDATE_CURRENT`: 갱신한 현재 topic 전체를 `currentTopic`에 반환하고 `newTopic=null`
- `START_NEW`: 기존 topic이 있으면 정리한 전체 내용을 `currentTopic`에, 새 topic 초안을 `newTopic`에 반환
- 첫 topic 생성: `START_NEW`와 `currentTopic=null`을 사용
- `topicTitle`: 2~80자 단일 행 명사구
- `overview`: 기존 사실과 새 window를 연결한 2~4문장, 최대 2,000자
- `items`: 중요도를 선별하지 않고 모든 비중복 정보를 역할별로 저장하며 topic당 1~12개, 각 content 최대 300자
- item type: `DEFINITION|FACT|MECHANISM|PROCEDURE|EXAMPLE|CAUTION`
- item label: `DEFINITION`은 필수이고 나머지는 필요할 때 사용하며, runtime 보존 검증의 임시 identity로 활용
- `overview`와 item `content`: `~습니다/~합니다/~입니다`체를 금지하고 `~함/~됨/~있음/~필요` 형태의
  간결한 명사형 서술을 사용
- 기존 item은 같은 사실을 합치는 경우 외에는 삭제하지 않는다. 최대 12개 제한과 기존 identity 보존을 함께
  적용하므로 12개가 찬 topic에는 새 identity를 추가할 수 없고 `START_NEW` 재작성을 요구한다. 동일 identity를
  유지하는 제목·overview·content 정리는 허용한다.

application state의 topic은 다음 의미를 가진다.

```text
topicId          세션 안에서 변하지 않는 식별자
topicRevision    같은 topic 내용이 교체될 때마다 1 증가
status           ACTIVE | FINALIZED
title            현재 제목
overview         설명 흐름을 가진 표시용 본문
items            type·label·content로 분류한 비중복 강의 정보의 의미상 정본
```

세션에는 `ACTIVE` topic을 최대 하나만 둔다. `UPDATE_CURRENT`는 같은 `topicId`의 revision을 올리고,
`START_NEW`는 현재 topic을 `FINALIZED`로 바꾼 뒤 새 `topicId`, revision 1의 `ACTIVE` topic을 만든다.
`FINALIZED`된 topic은 라이브 중 다시 열지 않으며, 잘못된 merge/split은 종료 후 refined snapshot에서만
교정한다.

### 3. Redis 결과는 변경 topic 묶음 upsert로 발행한다

contract v1의 `lecture.note.chunk.appended`와 `markdownFragment`는 과거 내용을 교체할 수 없으므로 목표 UX를
표현하지 못한다. 후속 contract v2에서는 한 모델 호출로 변경된 topic 1~2개를 하나의 event에 담는
`lecture.note.draft.updated`를 사용한다.

```json
{
  "contractVersion": "2",
  "type": "lecture.note.draft.updated",
  "eventId": "evt-...",
  "sessionId": "...",
  "lessonId": "...",
  "sttSessionId": "...",
  "updateSequence": "4",
  "latestSttSequence": "128",
  "topics": [
    {
      "topicId": "topic-1",
      "topicRevision": "3",
      "status": "FINALIZED",
      "topicTitle": "Redis Consumer Group",
      "overview": "Consumer Group은 여러 소비자가 하나의 Stream을 나누어 처리하도록 함.",
      "items": [
        {
          "type": "DEFINITION",
          "label": "ACK",
          "content": "상태 저장과 결과 발행까지 완료됐음을 확인하는 신호임"
        }
      ]
    },
    {
      "topicId": "topic-2",
      "topicRevision": "1",
      "status": "ACTIVE",
      "topicTitle": "Pending 메시지 복구",
      "overview": "ACK되지 않은 메시지는 Pending 상태로 남음.",
      "items": [
        {
          "type": "FACT",
          "label": "Pending 상태",
          "content": "ACK되지 않은 메시지가 Pending 목록에 남음"
        }
      ]
    }
  ],
  "occurredAt": "2026-08-03T12:00:30+09:00"
}
```

`UPDATE_CURRENT` event에는 같은 topic의 새 snapshot 하나를, `START_NEW` event에는 확정된 이전 topic과 새
활성 topic 두 개를 순서대로 담는다. Backend는 `eventId`로 event 중복을 제거하고, 저장된
`topicRevision`보다 큰 snapshot만 topic 단위로 교체한다. 한 event에 전환 결과를 함께 넣어 이전 topic만
확정되고 새 topic은 보이지 않는 중간 상태를 만들지 않는다.

Markdown은 모델이 직접 만들지 않고 구조화 topic에서 결정론적으로 렌더링한다.

```md
## Redis Consumer Group

Consumer Group은 여러 소비자가 하나의 Stream을 나누어 처리하도록 함. 처리 완료 여부는 ACK를 기준으로
추적함.

### 개념

- **ACK** — 상태 저장과 결과 발행까지 완료됐음을 확인하는 신호임
```

renderer는 존재하는 item type만 `개념/사실/동작 원리/처리 순서/예시/주의사항` section으로 만든다. live read
model은 topic upsert로 갱신하고,
종료 후 `lecture.note.refined.snapshot`은 전체 topic을 교체하는 기존 역할을 유지한다. contract v2의 정확한
field 제한·ACK·순서 규칙은 producer 구현과 함께 `docs/CONTRACT.md` 및 Spring DTO에 동반 반영한다.

### 4. checkpoint와 구현 순서

기존 pending, in-flight, outbox 복구 경계는 유지하되 checkpoint의 note를 새 topic 구조로 바꾼다. outbox에는
재전송해도 같은 `eventId`, `updateSequence`, topic revision과 payload가 유지되는
`lecture.note.draft.updated` 전체를 저장한다.

구현은 다음 순서로 제한한다.

1. 순수 topic model·reducer·Markdown renderer를 `overview`, typed items, revision, status 기반으로 변경한다.
2. GMS prompt v3와 응답 validation을 추가하고 고정 강의 샘플로 기존 방식과 A/B 평가한다.
3. checkpoint migration과 `lecture.note.draft.updated` outbox·Redis publisher를 구현한다.
4. 공유 계약과 Spring consumer/read model을 함께 변경한다.
5. Frontend에서 같은 `topicId`가 갱신되는 모습과 topic 전환을 확인한다.

첫 A/B 평가는 topic 분리 action 정확도뿐 아니라 다음을 기록한다.

- topic당 평균 overview 길이와 item 수·type 분포
- 기존 사실 보존과 새 사실 반영 여부
- overview와 items의 의미 중복
- `START_NEW`에서 이전 topic의 문장 완결성과 새 topic 오염 여부
- 호출당 입력·출력 token, latency, 세션 전체 호출 횟수

### 5. 2,081자 고정 강의문 1차 A/B 결과

2026-08-03에 `gpt-4.1`, temperature 0, 동일한 7개 caption window로 현재 append 방식과 활성 topic 갱신
prototype을 실제 호출했다. 입력 정본은 `ai/ai-api/scripts/lecture_note_active_topic_sample.json`이며 비교
도구는 `ai/ai-api/scripts/compare_active_topic_notes.py`다.

| 항목 | contract v1 append | 활성 topic prototype |
|---|---:|---:|
| window | 7 | 7 |
| 실제 GMS request | 7 | 11 |
| schema 재작성 request | 0 | 4 |
| 최종 topic | 4 | 2 |
| 최종 bullet | 21 | 10 |
| 전체 latency | 11,659ms | 28,488ms |

활성 topic 결과는 제목·설명 문단·소수 핵심 요점 구조로 읽기 쉬워졌고 bullet 나열을 줄였다. 반면 Stream,
Consumer Group, ACK, checkpoint, 증분 event 계약을 하나의 넓은 topic으로 합치는 미분할이 발생했고, topic을
거듭 교체하는 과정에서 ACK와 checkpoint의 일부 세부 내용이 최종 snapshot에서 사라졌다. 또한 모델이 최대
5개인 `keyPoints`를 최대 9개까지 반환해 7개 window 중 4개에서 한 번의 schema 재작성이 필요했다.

따라서 활성 topic 갱신 방향은 유지하되 GMS adapter와 runtime wire 전 다음 두 경계를 먼저 보강한다.

- 1차 prototype에서는 새 발화가 독립된 이름을 가지거나 `summary·keyPoints` 제한 안에서 기존 사실을
  보존할 수 없으면
  `START_NEW`를 선택하도록 topic 용량 경계를 prompt에 추가한다.
- 기존 사실 삭제 금지를 명시하고, 가능한 structured schema 지원 여부를 확인한다. 지원되지 않으면 schema
  validation 실패에 한해 bounded retry하며 최초 위반과 추가 request를 metric으로 남긴다.

이 한 샘플만으로 prompt를 확정하지 않는다. topic 미분할과 기존 사실 유실을 고정 평가 항목으로 추가한 뒤
서로 다른 강의 샘플에서 재확인한다.

### 6. 역할 기반 items와 명사형 문체 2차 A/B 결과

1차 결과의 주관적인 `keyPoints` 선별과 최대 5개 제한을 제거하고 `overview`와 역할 기반 `items`로 같은
강의문을 다시 평가했다. GMS의 Pydantic structured output을 사용해 JSON 중첩·enum·개수 제약을 생성 단계에서
강제했으며, `overview`와 `content`의 모든 문장은 `~함/~됨/~임/~음/~필요` 계열 명사형 종결인지
validation에서 확인했다.

| 항목 | contract v1 append | 역할 기반 활성 topic |
|---|---:|---:|
| window | 7 | 7 |
| 실제 GMS request | 7 | 8 |
| schema 재작성 request | 0 | 0 |
| semantic 재작성 request | 0 | 1 |
| 최종 topic | 4 | 4 |
| 최종 정보 항목 | bullet 21 | typed item 33 |
| 전체 latency | 10,131ms | 34,491ms |
| 명사형 문체 위반 | 측정 안 함 | 0 |

typed item 33개는 `DEFINITION 2`, `FACT 13`, `MECHANISM 5`, `PROCEDURE 5`, `EXAMPLE 2`,
`CAUTION 6`으로 분류됐다. Stream 기본, Consumer Group·ACK, checkpoint·증분 발행, 노트 품질 관리가
각각 독립 topic으로 나뉘었고, 1차에서 사라졌던 ACK 경계와 checkpoint 세부 정보도 최종 결과에 남았다.
Markdown은 `핵심 내용`이라는 단일 section 대신 실제로 존재하는 정보 역할의 section만 렌더링했다.

세 번째 topic이 12개 item으로 찬 뒤에도 모델이 `UPDATE_CURRENT`를 선택한 첫 결과에서는 마지막 content가
제한 길이에 맞춰 중간에서 잘렸다. 이를 prompt 권고만으로 두지 않고 application validation에서 거부한 뒤
한 번 재작성하자 네 번째 topic이 생성되고 정보가 온전히 분리됐다. 기존 item 보존은 MVP에서
`type + label` identity로 검사하며, label이 없는 item만 정규화 content를 사용한다. 안정적인 `itemId`와
항목별 patch는 실제 runtime 결과에서 label 변경 문제가 확인될 때 도입한다.

따라서 역할 기반 구조, 명사형 문체, structured output, 12개 capacity guard를 다음 runtime prototype의
기준으로 채택한다. 다만 append 방식보다 latency가 약 3배이고 출력량이 커졌으므로 여러 강의 샘플에서 정보
중복과 비용을 다시 측정한 뒤 wire contract를 확정한다.

이번 전환에서 매 호출 전체 노트 재생성, 확정 topic의 라이브 재작성, raw caption 전체 보관·재입력,
라이브 자동 merge/split, 별도 vector 검색은 구현하지 않는다.

### 7. 정보 타입 수 3차 A/C 비교

역할 6개를 미리 정한 구조가 Redis 예시에 과적합됐는지 확인하기 위해 상세 타입 A와 최소 타입 C를 비교했다.

- A: `DEFINITION|FACT|MECHANISM|PROCEDURE|EXAMPLE|CAUTION`
- C: `CONCEPT|EXPLANATION|EXAMPLE|CAUTION`

입력은 수학 수식·풀이, 역사 인과, 기술 비교, 과학 실험 절차, 인문 논증, 반복·미완성 STT,
언어 규칙·예외, 통계 해석의 8개 고정 샘플로 구성했다. 각 샘플은 실제 누적 갱신과 같은 4개 window로
나눴으며 입력 정본은 `ai/ai-api/scripts/lecture_note_structure_samples.json`, 실행 도구는
`ai/ai-api/scripts/compare_lecture_note_structures.py`다. 두 후보는 같은 `gpt-4.1`, temperature 0 조건에서
생성했다. 호출·재시도·상태 전이·중복 제거·Markdown 안전 처리는 공통 실험 엔진을 사용하고, 공통 prompt
template에서 타입 이름과 설명만 다르게 구성했다. 후보 이름을 숨기고 샘플마다 제시 순서를 교차한 평가로
정확성·누락·중복·구조·가독성·topic 경계를 각각 5점 척도로 비교했다.

| 항목 | A 상세 6타입 | C 최소 4타입 |
|---|---:|---:|
| 선호 샘플 | 4/8 | 3/8 |
| 동점 | 1/8 | 1/8 |
| 평균 평가 합계 | 27.88/30 | 28.62/30 |
| 평균 topic 수 | 2.12 | 2.25 |
| 평균 item 수 | 15.38 | 15.75 |
| 평균 latency | 14,965.25ms | 13,926.62ms |
| 기존 item 유실 | 0 | 0 |
| 전체 재작성 request | 0 | 0 |

A는 수학, 역사 인과, TCP·UDP 비교, 언어 규칙 샘플에서 선호됐다. 정의·동작 원리·예시·주의사항처럼
역할이 분명한 정보를 빠짐없이 찾고 구분하는 데 유리했다. 특히 언어 샘플에서 C는 완료·결과 용법의 예시와
`just` 위치를 빠뜨렸다. C는 과학 실험, 인문 논증, 통계 해석에서 선호됐고, 역할이 겹치는 설명을 덜
인위적으로 분류했다. 반복·미완성 STT 샘플은 두 후보 모두 반복과 운영 안내를 제외하고 실제 주제 전환을
보존해 동점이었다.

C는 A보다 평균 점수와 latency가 소폭 나았지만 선호 샘플 수는 적었고, 평균 item 수는 오히려 0.37개
많았다. 따라서 타입 수를 줄이는 것만으로 bullet 과다나 정보 선택 문제가 해결되지는 않는다. 타입 수보다
같은 설명을 몇 개의 학습 단위로 합칠지, 예시·예외를 언제 반드시 보존할지가 다음 품질 실험의 핵심이다.

실험 중 `~함/~됨/~임`처럼 열거한 종결만 허용하는 검증은 `함수의 순간 변화율` 같은 자연스러운 명사구도
거부해 출력 문체를 특정 예시에 맞추는 문제가 확인됐다. 따라서 note 문체 검증은 허용 어미 목록이 아니라
`~니다/~한다/~해요` 같은 명확한 문장체 종결만 거부하는 휴리스틱으로 완화하고, prompt에는
`~함/~있음`과 명사구를 모두 예시로 든다. `캐나다`, `사이다`처럼 `다`로 끝나는 명사구는 허용한다.

C는 다음 prototype 후보로 유지하지만 이번 결과만으로 채택하지 않는다. 같은 모델이 생성과 평가를 담당한
샘플당 1회 결과이고 30분 실제 강의가 아니며 A와 C 어느 쪽도 지배적이지 않다. wire contract와 runtime
enum을 변경하지 않고 runtime은 A를 유지한다. 다음 비교에서는 타입 수를 그대로 두고 topic당 정보 밀도와
필수 예시·예외 보존 규칙을 먼저 조정한 뒤, 동일 샘플 반복 평가와 실제 강의 검증으로 타입을 확정한다.

비교 실행 명령은 다음과 같다.

```bash
uv run --frozen python -m scripts.compare_lecture_note_structures --summary-only
```

## MVP에서 하지 않는 것

- `caption.segment.final` 신규 계약
- raw audio 또는 녹화 HLS 재입력
- Spring consumer, core DB, REST snapshot, STOMP push
- Frontend topic accordion 실연동
- session-relative time 변환과 영상 seek
- 여러 ai-api instance의 session lease·`XAUTOCLAIM`
- Redis 자체 장애와 여러 인스턴스 사이의 checkpoint 합의
- LLM 실패 retry·실패 window 복구·최종 실패 상태 설계
- topic 변경 재확인, 과거 topic 복귀, 자동 merge/split
- 강사 검수·게시·최종 강의 노트
- 자료 RAG를 이용한 용어 정의

이 항목들은 MVP 결과에서 실제 문제가 확인될 때 우선순위를 정한다.

## 검증과 다음 결정

자동 테스트는 다음 범위로 제한한다.

- 별도 consumer group이 RAG group과 같은 delta를 독립적으로 받음
- sequence 중복·gap·새 attempt·completion 처리
- 15/25/40초와 80/400자 window 경계
- 공백 보존과 문장부호 우선 cut
- LLM JSON validation 실패가 기존 note를 훼손하지 않음
- append event의 chunkSequence 증가, 완료 event, Stream `MAXLEN`
- 종료 후 refined snapshot 순서·전체 topic 직렬화·outbox 복원

실제 한국어 강의 30분에서 다음을 기록한다.

- 첫 note가 나온 시간과 이후 update 간격
- topic 과분할·미분할 횟수
- 중복·근거 없는 key point
- 모델 latency와 호출 횟수·비용
- Redis caption consumer lag와 누락 sequence

목표 후보는 첫 note 45초 이내, 이후 update 20~45초 간격이다. 품질 임계값은 결과를 본 뒤 정한다.
topic 분리가 괜찮으면 다음 ADR 개정에서 Spring·Frontend 연결을 추가하고, 불안정하면 그때
`caption.segment.final`과 topic 전환 확인 window를 도입한다.

## 계약·완료 판단

현재 단계는 ai-api 내부에서 별도 caption consumer group, GMS adapter, Redis append event Stream까지
연결했다. AI→Spring Redis payload를 공유 계약으로 승격했으므로 `docs/CONTRACT.md` §3-4a와 AI 통신 계약을
같이 갱신한다. Python producer의 field·직렬화·순번은 unit·실제 Redis integration test로 검증한다.
Spring consumer가 아직 없으므로 Java 소비 계약 테스트는 해당 구현에서 추가하며, 그 전에는 사용자 기능
완료로 보고하지 않는다. 운영 Redis 연결·GMS JSON 호환성·30분 품질은 EC2 실험의 완료 조건이다.
