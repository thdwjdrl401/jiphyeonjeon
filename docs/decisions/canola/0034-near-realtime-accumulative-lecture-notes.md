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
  → Redis MVP snapshot + Stream
```

MVP 결과가 만족스러울 때만 Spring REST·WebSocket, core read model, topic accordion을 공통 계약으로
승격한다. 녹화본 기반 다시보기 교정 자막은 이번 MVP 범위에 포함하지 않고 별도 결정으로 다룬다.

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
계속 처리한다. MVP snapshot에 별도 `incomplete` 필드는 추가하지 않는다. handler가 in-memory session
buffer에 반영되면 ACK한다. 프로세스 재시작 시 snapshot을 복원하는 동작은 후속으로 구체화한다.

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

### 5. 결과도 Redis에 싣는다

MVP는 변경분 patch 대신 작은 전체 snapshot을 매번 저장한다. 구현과 결과 확인이 가장 단순하기
때문이다.

```text
SET ai:lecture-notes:mvp:snapshot:{sessionId} <snapshot-json> EX 86400
XADD ai:lecture-notes:mvp MAXLEN ~ 10000 ...
```

snapshot과 Stream event에는 다음을 담는다.

```json
{
  "schemaVersion": "1",
  "type": "lecture.note.snapshot",
  "eventId": "evt-...",
  "sessionId": "...",
  "lessonId": "...",
  "sttSessionId": "...",
  "noteVersion": "4",
  "coveredThroughSequence": "128",
  "status": "PROCESSING",
  "topics": [
    {
      "topicId": "topic-1",
      "title": "Refresh Token의 역할",
      "keyPoints": ["Access Token 만료 뒤 재발급에 사용한다."]
    }
  ],
  "markdown": "## Refresh Token의 역할\n\n- Access Token 만료 뒤 재발급에 사용한다.",
  "occurredAt": "2026-07-29T12:00:30+09:00"
}
```

MVP Redis key와 event는 실험용이며 `docs/CONTRACT.md`의 공유 계약이 아니다. Spring이나 Frontend가
직접 의존하지 않는다. 결과는 monitor script 또는 Redis CLI로 보고 평가한다.

## 구현 순서와 단계별 제한

한 변경에서 전체 runtime을 한꺼번에 연결하지 않고 아래 단계가 각각 테스트를 통과한 뒤 다음 단계로
넘어간다.

1. **순수 window 상태 머신**: Redis·GMS·async task 없이 delta 순서, 중복·gap, 15/25/40초와
   80/400자 경계, 문장부호, attempt 전환, completion flush만 구현한다.
2. **note reducer와 Markdown renderer**: `CONTINUE|START_NEW`, key point 중복 제거, `noteVersion`,
   제한된 Markdown 생성을 순수 로직으로 구현한다.
3. **application orchestration**: `LectureNoteModel`과 snapshot store를 port로 두고 fake 구현으로 세션별
   단일 호출과 호출 중 window 병합을 검증한다.
4. **Redis 결과 adapter**: snapshot TTL과 결과 Stream `MAXLEN`을 구현하고 Redis integration test를
   추가한다.
5. **GMS adapter**: RAG adapter와 분리된 `LectureNoteModel`을 구현하고 구조화 JSON 지원 여부, latency,
   호출 수를 확인한다.
6. **별도 caption consumer와 lifecycle**: `ai-live-notes-mvp-v1` group을 ai-api lifecycle에 연결하고
   RAG group과 독립적으로 같은 entry를 받는지 검증한다. MVP는 모든 실행 환경에서 이 consumer를
   시작하며 별도 enable 환경변수를 두지 않는다.
7. **30분 강의 실험**: Redis 결과와 metric을 관찰해 품질·지연·비용을 기록한 뒤 후속 범위를 결정한다.

첫 구현 변경은 1단계만 포함한다. config·wiring·lifecycle, Redis, GMS, Spring, Frontend, DB, HTTP API는
건드리지 않는다.

## MVP에서 하지 않는 것

- `caption.segment.final` 신규 계약
- raw audio 또는 녹화 HLS 재입력
- Spring consumer, core DB, REST snapshot, STOMP push
- Frontend topic accordion 실연동
- session-relative time 변환과 영상 seek
- 여러 ai-api instance의 session lease·`XAUTOCLAIM`
- 프로세스 재시작 시 기존 snapshot 복원
- LLM 실패 retry·실패 window 복구·최종 실패 상태 설계
- topic 변경 재확인, 과거 topic 복귀, 자동 merge/split
- 강사 검수·게시·최종 강의 노트
- 자료 RAG를 이용한 용어 정의

이 항목들은 MVP 결과에서 실제 문제가 확인될 때 우선순위를 정한다.

## 검증과 다음 결정

자동 테스트는 다음만 만든다.

- 별도 consumer group이 RAG group과 같은 delta를 독립적으로 받음
- sequence 중복·gap·새 attempt·completion 처리
- 15/25/40초와 80/400자 window 경계
- 공백 보존과 문장부호 우선 cut
- LLM JSON validation 실패가 기존 note를 훼손하지 않음
- snapshot TTL, noteVersion 증가, Stream `MAXLEN`

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

이번 단계는 순수 window 상태 머신과 ai-api 단위 테스트까지 추가하며 실제 Redis event나 API는 아직
만들지 않는다. 공유 런타임 계약과 HTTP 상태코드를 바꾸지 않으므로 FE/BE 계약 테스트와
`docs/CONTRACT.md` 수정은 불필요하다. Redis adapter가 들어가는 단계에는 integration test를 함께
추가하며, Redis 결과만 나온 상태를 사용자 기능 완료로 보고하지 않는다.
