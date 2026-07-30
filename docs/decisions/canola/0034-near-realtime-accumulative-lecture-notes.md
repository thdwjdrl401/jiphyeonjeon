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

### 3. LLM은 두 가지 판단만 한다

MVP에서는 복잡한 candidate·subtopic·return 상태를 만들지 않는다. 모델은 현재 topic을 계속할지 새
topic을 시작할지만 판단한다.

```json
{
  "topicAction": "CONTINUE",
  "topicTitle": "Refresh Token의 역할",
  "keyPoints": [
    "Access Token 만료 뒤 재발급에 사용한다."
  ]
}
```

허용값과 제한은 다음과 같다.

- `topicAction`: `CONTINUE|START_NEW`
- `topicTitle`: 최대 80자
- `keyPoints`: 호출당 최대 3개, 각 300자
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

- 첫 결과로 첫 topic을 만든다.
- `CONTINUE`면 현재 topic에 새 point를 추가한다.
- `START_NEW`면 현재 topic을 닫고 새 topic을 즉시 만든다.
- 완전히 같은 point만 정규화해 중복 제거한다.
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

caption 수집이 끝나면 전체 노트를 다시 보내지 않고 `lecture.note.capture.completed`를 별도로 발행한다.
여기에는 `lastChunkSequence`, `lastSttSequence`, `reason`만 담는다. `chunkSequence`는 세션별 추가 조각
순번이며 `1`부터 증가한다. 재전송 event는 같은 `eventId`와 순번을 유지해야 하지만 retry 자체는 이번
구현 범위가 아니다.

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
- 라이브 중 잘못 나뉜 topic을 고치거나 이전 요점을 수정할 수 없다. 라이브는 append-only로 제한하고,
  강의 종료 후 재정제는 별도 event/파이프라인으로 다룬다.
- checkpoint 저장 뒤 caption을 ACK하므로 모델 호출이나 결과 발행 도중 프로세스가 종료돼도 window와
  발행 대기 event를 재시작 후 복원한다. 모델 자체 실패의 retry 횟수·backoff·최종 실패 상태는 별도다.
- 여러 ai-api replica가 같은 세션을 처리하면 순번 충돌이 생길 수 있다. 현재는 단일 replica만 허용한다.

## 구현 순서와 단계별 제한

전체 구조를 빠르게 확인할 수 있도록 아래 단계를 독립 커밋으로 연결하고, 자동 테스트와 리뷰는
1~6단계 구조를 만든 뒤 한 번에 수행한다. 실제 Redis·GMS 동작은 7단계 EC2 실험에서 별도로 검증한다.

1. **순수 window 상태 머신**: Redis·GMS·async task 없이 delta 순서, 중복·gap, 15/25/40초와
   80/400자 경계, 문장부호, attempt 전환, completion flush만 구현한다.
2. **note reducer와 Markdown renderer**: `CONTINUE|START_NEW`, key point 중복 제거, `chunkSequence`,
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
변경했고, 후속 1단계의 단일 프로세스 재시작 복구도 구현했다. Spring, Frontend, DB, HTTP API는 여전히
범위 밖이다. 다음 작업은 후속 2단계의 판단 품질을 고정 샘플로 비교한 뒤 EC2 단일 ai-api replica에서
7단계 실험을 수행하는 것이다.

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

복구 테스트는 checkpoint 전·후, caption ACK 전·후, 모델 호출 전·후, outbox 저장 후, 결과 transaction
후 경계를 고정한다. 재처리 시 같은 출력 event가 중복 발행되지 않고 partial text, topic,
`chunkSequence`, completion 순서가 유지되는지를 검증한다.

### 2. 라이브 노트 판단 품질

복구 기반을 고정한 다음 모델의 내부 판단을 `IGNORE|APPEND|START_NEW`로 바꾼다. 외부 append event의
`topicAction` 계약은 그대로 두고 `APPEND`만 `CONTINUE`로 변환한다. `IGNORE`는 operation만 완료하며 빈
event와 `chunkSequence`를 만들지 않는다.

prompt v2는 반복·잡음·미완성 발화를 `IGNORE`, 같은 개념의 설명·예시를 `APPEND`, 독립적으로 이름 붙일
수 있는 새 개념만 `START_NEW`로 판단하게 한다. 첫 구현은 Unicode·공백·문장부호 수준의 가벼운 중복
정규화까지만 사용하며 embedding, confidence, 자동 topic merge/split은 넣지 않는다.

고정 한국어 강의 샘플로 기존 prompt와 v2를 A/B 평가하고 근거성, 누락, 의미 중복, topic 경계,
요점 원자성, 제목 품질, 지연·호출 비용을 기록한다. 실제 과분할이 확인될 때만 한 window 동안 topic 전환을
보류해 다음 window로 재확인한다. 확인되지 않으면 라이브 지연을 늘리지 않는다.

### 3. 종료 후 refined snapshot

라이브 출력은 append-only 초안으로 유지한다. 강의 종료 뒤 별도 정제 단계가 전체 초안을 보고 topic
merge/split, 제목 교정, 중복 제거를 수행해 하나의 refined snapshot으로 발행한다. 라이브 event를 수정하거나
덮어쓰지 않으며, snapshot 계약·저장 주체·실패 처리는 이 단계 착수 시 별도 확정한다.

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
