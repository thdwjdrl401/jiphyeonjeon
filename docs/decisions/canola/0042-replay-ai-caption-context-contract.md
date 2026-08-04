# ADR-0042: 다시보기 영실이에 필요한 시간·근거 계약 요청

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 판단 정책:
> [../../harness/POLICY.md](../../harness/POLICY.md) · 공유 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 제안
- **일자**: 2026-07-31
- **관련**:
  [ADR-0047](../songjeongki/0047-live-ai-answer-sse-proxy.md)(라이브 AI 답변),
  [ADR-0039](../songjeongki/0039-replay-playback-api.md)(다시보기 재생 시간축),
  [ADR-0052](../songjeongki/0052-caption-segment-anchor-consumption.md)(최종 자막·STT 시작 앵커)

## 요청 요약

다시보기에서 영실이에게 질문하면 **질문을 보낸 영상 위치 주변의 확정 자막**과 기존 강의 자료를 함께
근거로 사용해야 한다. 사용자는 답변뿐 아니라 실제 사용된 근거 내용과 영상 시점을 확인할 수 있어야 한다.

구현 구조·클래스·파일·작업 순서는 각 FE·Spring·AI 오너가 결정한다. 이 문서는 세 오너가 맞춰야 할
동작과 데이터만 제안한다.

## 현재 부족한 점

- 현재 공개 AI 질문 endpoint는 Live 전용이다.
- Live의 `contextTimeMs`는 STT attempt-local 시간이라 VOD 재생 위치와 같은 축이 아니다.
- ai-api는 검색한 `RetrievedEvidence.content`를 모델에는 주지만 브라우저에는 source ID·page·시간만 준다.
- 따라서 VOD에서 “여기서 설명한 내용”을 안정적으로 특정하거나, 사용자가 실제 근거 내용을 확인할 수 없다.

## 원하는 사용자 흐름

```text
사용자가 VOD 12:15에서 질문
  → FE가 질문과 12:15의 세션 위치를 Spring에 전달
  → Spring이 재생 권한·실제 session·주변 확정 자막을 결정
  → AI가 기존 자료 Top K와 주변 자막으로 답변
  → FE가 답변과 근거 excerpt를 표시
  → 자막 근거를 누르면 12분대 영상으로 이동
```

질문 후 영상을 계속 재생하거나 다른 위치로 탐색해도 이미 보낸 질문의 기준 시점은 바뀌지 않는다.

## 필요한 공개 endpoint

```http
POST /api/lessons/{lessonId}/ai/answers/stream
Content-Type: application/json
Accept: text/event-stream
```

```json
{
  "question": "여기서 말한 consumer group이 뭐야?",
  "playbackSessionMs": 735000
}
```

- `playbackSessionMs`는 `liveSession.startedAt`을 0으로 둔 세션 상대 시간이다.
- FE의 player time만 보내지 않고 `mediaTimeMs + source.availableFromMs`로 계산한 값을 보낸다.
- 질문 버튼을 누른 순간의 값을 사용한다.
- 클라이언트는 `sessionId`, `curriculumId`, 자막 text, `requestId`를 보내지 않는다.
- 경로는 운영 nginx의 SSE buffering 해제 규칙을 위해 `/stream`으로 끝난다.
- Live 질문은 기존 `/api/live-sessions/{sessionId}/ai/answers/stream`을 계속 사용한다.

접근 권한은 기존 VOD 재생과 같아야 한다. 수강생은 활성 수강·레슨 공개·replay 공개가 필요하고, 소유
강사는 게시 전 미리보기를 허용한다.

## Spring에서 필요한 자막 문맥

Spring이 같은 `(sessionId, sttSessionId)`의 `caption.stream.started`와 `caption.segment.final`을 연결해
세션 시간으로 변환한 확정 자막을 제공해야 한다.

```text
attemptStartSessionMs
  = audioStartedAt - liveSession.startedAt

captionStartSessionMs
  = attemptStartSessionMs + startStreamElapsedMs

captionEndSessionMs
  = attemptStartSessionMs + endStreamElapsedMs
```

필요한 초기 범위는 다음과 같다.

- `caption.segment.final`만 사용
- 질문 시점을 포함하는 발화 전체
- 그 발화 이전 최대 30초
- 질문 시점 뒤에 시작한 다음 발화는 제외
- 최대 20개 발화, text 합계 최대 6,000자
- 앵커가 없는 발화는 정확한 시간으로 가장하지 않고 제외
- 자막이 없어도 자료 검색은 계속 수행

Spring은 path의 `lessonId`와 재생 자산을 기준으로 실제 `curriculumId`·`sessionId`를 결정해야 한다.
클라이언트가 다른 강의나 세션의 근거를 선택할 수 없어야 한다.

## 필요한 Spring → ai-api endpoint

기존 Live v1의 시간 의미를 바꾸지 않고 Replay용 내부 endpoint를 별도로 요청한다.

```http
POST /internal/v2/rag/answers:stream
Accept: text/event-stream
X-Internal-Signature: base64(HMAC-SHA256(AI_INTERNAL_SECRET, rawBody))
```

```json
{
  "requestId": "0198...",
  "lessonId": "22222222-2222-4222-8222-222222222222",
  "curriculumId": "55555555-5555-4555-8555-555555555555",
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "question": "여기서 말한 consumer group이 뭐야?",
  "context": {
    "mode": "REPLAY",
    "questionSessionMs": 735000,
    "captions": [
      {
        "sttSessionId": "stt-attempt-2",
        "segmentIndex": 42,
        "startSessionMs": 711200,
        "endSessionMs": 716800,
        "text": "컨슈머 그룹은 여러 소비자가 메시지를 분담해서 처리하도록 합니다."
      }
    ]
  },
  "issuedAtMs": 1785450000000
}
```

- `lessonId`, `curriculumId`, `sessionId`, caption은 Spring이 조회한 값이어야 한다.
- 현재 ai-api 자료 검색이 `curriculumId`를 사용하므로 Replay 요청에서도 필수다.
- raw body HMAC, `issuedAtMs`, requestId 중복, Accept·SSE 규칙은 기존 v1과 같은 수준을 요구한다.
- ai-api가 Spring DB나 Redis에서 과거 VOD 자막을 다시 조회할 필요는 없다.
- 기존 `/internal/v1/rag/answers:stream`의 요청·응답은 변경하지 않는다.

## 필요한 RAG 결과

기존 자료 검색 Top K 3과 질문 위치 주변 자막을 답변 근거로 사용한다.

- Top K 3은 PPTX 자료 검색 개수다.
- 자막 근거가 있으면 자료 근거에 자막 source 한 개가 추가될 수 있다.
- 자료와 자막이 모두 없을 때만 `answer.insufficient`를 반환한다.
- 기존 `answer.delta`, `answer.done`, `answer.insufficient`, `answer.error` 흐름은 유지한다.

`answer.done.sources`에는 사용자가 근거 내용을 확인할 수 있도록 최대 300자의 plain-text `excerpt`가
필요하다.

```json
{
  "type": "PPTX",
  "materialId": "22222222-2222-4222-8222-222222222222",
  "page": 12,
  "excerpt": "Consumer Group은 여러 Consumer가 메시지를 분담해서 처리하도록 합니다."
}
```

```json
{
  "type": "CAPTION",
  "sessionId": "11111111-1111-4111-8111-111111111111",
  "startSessionMs": 711200,
  "endSessionMs": 716800,
  "excerpt": "컨슈머 그룹은 여러 소비자가 메시지를 분담해서 처리하도록 합니다."
}
```

- `excerpt`는 검색된 실제 원문에서 잘라야 하며 별도 모델이 다시 요약한 내용이면 안 된다.
- HTML·Markdown이 아닌 plain text로 전달한다.
- PPTX source 중복 기준은 `(materialId, page)`다.
- 자막 source 중복 기준은 `(sessionId, startSessionMs, endSessionMs)`다.
- Live v1 source에는 이 제안 때문에 필드를 추가하지 않는다.

## 오너별로 필요한 결과

| 오너 | 필요한 결과 |
|---|---|
| FE | 질문 순간의 `playbackSessionMs` 전달, 기존 SSE 답변 표시, source excerpt 표시, VOD 자막 source 선택 시 영상 이동 |
| Spring | 기존 replay 권한 적용, 실제 lesson/curriculum/session 결정, 확정 자막의 정확한 세션 시간 변환, ai-api v2 호출 |
| AI | Replay v2 요청 수용, 기존 자료 Top K 3과 전달받은 자막을 근거로 사용, 사용한 source와 excerpt 반환 |

각 오너가 내부 구현 방법을 선택하되 위 공개 동작과 wire 의미는 함께 맞춘다.

## 수용 시나리오

1. 사용자가 다시보기 12:15에서 “여기서 말한 consumer group이 뭐야?”라고 질문한다.
2. 공개 요청에 `playbackSessionMs=735000`이 들어간다.
3. Spring이 실제 replay session과 11:45~12:15의 확정 자막을 결정한다.
4. AI가 기존 PPTX Top K 3과 전달받은 자막 안에서 근거를 선택한다.
5. 답변 완료 event에 실제 사용한 source와 plain-text excerpt가 포함된다.
6. FE가 excerpt를 표시하고 자막 source 선택 시 해당 `startSessionMs`로 이동한다.
7. 다른 lesson·curriculum·session의 자료나 자막은 근거에 섞이지 않는다.

## 이번 요청에서 제외

- FE·Spring·AI 내부 클래스와 파일 구조
- 구현 순서와 MR 분할 방식
- cache·별도 caption projection table
- 개인 질문 이력과 서버 대화 기억
- 판서·화면 frame·vision 근거
- Live v1을 v2로 이관하는 작업

## 문서 상태

이 문서는 세 오너에게 전달할 요구사항 제안이며 아직 runtime 계약이나 구현 완료를 의미하지 않는다.
실제 구현 합의가 끝난 MR에서 `docs/CONTRACT.md`, `docs/ai/CONTRACT.md`, 실제 DTO와 계약 테스트를 함께
갱신한다.

