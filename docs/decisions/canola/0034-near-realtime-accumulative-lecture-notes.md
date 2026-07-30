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

`caption.delta`를 `(sessionId, sttSessionId, sequence)` 순으로 붙이고 `eventId`와 sequence로 중복을
제거한다. handler가 in-memory session buffer에 반영되면 ACK한다. 프로세스가 재시작되면 아직 LLM에
보내지 않은 최대 40초가 사라질 수 있으며 MVP에서는 이를 허용한다.

새 `sttSessionId`가 시작되면 이전 window를 가능한 만큼 flush하고 새 attempt로 전환한다.
`caption.stream.completed`가 오면 남은 window를 처리하고 note를 완료 상태로 만든다.

### 2. 시간과 문장부호를 함께 사용해 자른다

공백은 문장 경계로 사용하지 않는다. delta의 leading space를 포함해 text를 순서대로 그대로 붙인다.
온점도 필수 조건이 아니라 자연스러운 cut 지점을 고르는 보조 조건이다.

| 정책 | MVP 초기값 |
|---|---:|
| 최소 window | 15초이면서 80자 이상 |
| 목표 window | 25초 |
| 최대 window | 40초 또는 400자 |
| 강한 종결 | `.`, `?`, `!`, `。`, `？`, `！`, 줄바꿈 |
| 이전 문맥 | 직전 window 마지막 1~2문장 |

동작은 다음으로 단순화한다.

1. 15초·80자 전에는 계속 축적한다.
2. 15~25초에 강한 종결로 끝나면 LLM에 보낸다.
3. 25초를 넘으면 다음 delta에서 문장부호와 무관하게 보낸다.
4. 40초 또는 400자에 도달하면 강제로 보낸다.
5. stream completion에서는 남은 text를 모두 보낸다.

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
window 하나로 합친다. JSON parse·validation이 실패하거나 모델이 timeout이면 이전 note를 유지하고
해당 window를 다음 입력과 합친다.

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

Markdown은 heading, unordered list, bold, inline code만 허용한다. raw HTML·image·외부 link는 만들지
않는다.

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

## MVP에서 하지 않는 것

- `caption.segment.final` 신규 계약
- raw audio 또는 녹화 HLS 재입력
- Spring consumer, core DB, REST snapshot, STOMP push
- Frontend topic accordion 실연동
- session-relative time 변환과 영상 seek
- 여러 ai-api instance의 session lease·`XAUTOCLAIM`
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
- LLM JSON validation과 timeout 시 이전 note 유지
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

이번 변경은 실험용 ADR만 추가하며 실제 Redis event나 API를 아직 만들지 않는다. 공유 런타임 계약과
HTTP 상태코드를 바꾸지 않으므로 FE/BE 계약 테스트와 `docs/CONTRACT.md` 수정은 불필요하다. MVP 코드가
들어갈 때 ai-api unit·Redis integration test를 함께 추가하며, Redis 결과만 나온 상태를 사용자 기능
완료로 보고하지 않는다.
