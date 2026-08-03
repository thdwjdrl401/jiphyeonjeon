# ADR-0010: GMS Responses API `previous_response_id`로 RAG 답변 대화 이어가기

- **상태**: 구현됨(AI 쪽만; Spring이 아직 `userId`/`conversationId`를 안 보내 실사용은 비활성 상태)
- **일자**: 2026-08-03
- **관련**: [ADR-0037(canola)](../canola/0037-replay-ai-caption-context-contract.md) §"이번 요청에서
  제외"(개인 질문 이력·서버 대화 기억), [ADR-0049(songjeongki)](../songjeongki/0049-fe-ai-chat-conversation-ux.md)
  §"남은 이슈"(AI Q&A 이력 API 없음), `ai/ai-api/CONTRACT.md` §7, `ai/ai-api/app/adapters/gms_openai_answer.py`

## 맥락

지금 ai-api는 질문마다 완전히 독립적인 GMS 호출(`chat.completions.create`)만 하고, 이전 turn을 기억하지
못한다. `ai/ai-api/CONTRACT.md` §7에 "이전 대화 turn이 이어져도 사실 근거는 이번 evidence만 쓰도록
system prompt만 대비해뒀고, turn을 실제로 이어붙이는 기능(response id 저장·재사용)은 미구현"이라고
이미 명시돼 있다 — 즉 이 기능은 처음부터 예정돼 있었지만 아직 구현되지 않은 상태였다.

FE 쪽도 같은 공백이 있다: ADR-0049는 "AI Q&A 이력 API가 없다(`AI-HISTORY-01` 제안 상태)"는 이유로
대화 이력을 서버에 저장하지 않고 클라이언트 메모리에만 두기로 결정했다(새로고침하면 사라짐).

**GMS가 실제로 Responses API를 지원하는지** 확인이 안 된 상태였는데, `AI_API_GMS_API_KEY`로 직접
호출해 검증했다(2026-08-03):

```
POST {GMS_OPENAI_BASE_URL}/responses
  {"model":"gpt-4.1","input":"ping","max_output_tokens":16}
  → HTTP 200, "id":"resp_08f1042c201c0bf6..."

POST {GMS_OPENAI_BASE_URL}/responses
  {"model":"gpt-4.1","input":"...","previous_response_id":"resp_...","max_output_tokens":30}
  → HTTP 200 (이전 turn을 이어서 정상 응답)
```

`/conversations`(OpenAI의 명시적 대화 객체 API)는 GMS 게이트웨이가 모든 요청 body에 `model` 필드를
요구하는 자체 라우팅 계층을 갖고 있어서(`model` 없으면 `"[GMS 오류] Model not found"`), `model`을
넣으면 이번엔 OpenAI 쪽에서 `"Unknown parameter: 'model'"`로 거부한다 — 즉 이 게이트웨이로는
`/conversations` 사용이 막혀 있다. 반면 `/responses` + `previous_response_id`는 **완전히 동작이
확인됐고**, 이 ADR이 다루는 "이전 turn 이어가기" 목적에는 `/conversations` 객체가 필요하지 않다.

## 결정

### 1. 이어가기 메커니즘: `previous_response_id` 체이닝만 사용

| 대안 | 판단 |
|---|---|
| **(채택) `/responses` + `previous_response_id`** | 실측으로 동작 확인됨. OpenAI가 대화 history를 provider 쪽에서 관리해주므로 우리가 과거 메시지 전문을 매번 다시 안 보내도 됨 |
| `/conversations` 객체로 명시적 대화 관리 | 이 GMS 게이트웨이에서 라우팅 계층 제약으로 막혀 있음(위 실측 참고). 여러 대화를 명시적으로 조회/나열해야 하는 요구사항이 생기면 재검토 |
| 매 요청에 과거 메시지 전문을 프롬프트에 직접 이어붙임(자체 구현) | provider가 이미 제공하는 기능을 재발명하는 것. 대화가 길어질수록 우리 쪽 프롬프트 조립 로직과 토큰 예산 관리가 계속 복잡해짐 |

`chat.completions.create()`(v1이 지금 쓰는 API)는 그대로 두고, 대화 이어가기가 필요한 경로만
`client.responses.create(..., previous_response_id=...)`로 바꾼다.

### 2. 매핑 키: `userId + sessionId + conversationId` (조회 전용, provider에는 안 보냄)

기존 원칙(`CONTRACT.md` §7: "requestId/sessionId/materialId/sttSessionId는 provider에 보내지
않는다")을 그대로 지킨다. `userId+sessionId+conversationId`는 **ai-api 내부에서만 쓰는 조회
키**이고, GMS에는 이 키로 찾은 **provider가 발급한 `response_id`만** 보낸다 — 우리 내부 식별자를
GMS에 노출하지 않는다.

```
Redis key: ai:conversation:{userId}:{sessionId}:{conversationId}
Redis value: 최신 response_id (string)
TTL: 설정값(기본 제안 30분), 매 turn마다 TTL 갱신
```

| 대안 | 판단 |
|---|---|
| **(채택) Redis, TTL 기반 만료** | 이미 `AI_API_REDIS_URL` 의존성이 있어 새 인프라가 필요 없다. TTL이 "대화가 언제 끝나는지"를 자연스러운 idle-timeout으로 정의해줘서, 별도 명시적 종료 신호 없이도 방치된 대화가 무한정 안 남는다 |
| PostgreSQL `ai` schema에 테이블 신설 | 영속성은 더 강하지만 TTL 자동 만료가 없어 별도 정리(cron/batch) 로직이 필요하고, 이 mapping은 근본적으로 "최근 대화 상태"라 벡터 검색처럼 오래 남을 필요가 없음 |
| process-local 메모리 | 기존 `InMemoryRequestRegistry`와 같은 문제 — 재시작하면 날아가고 multi-replica에서 안 맞음. 대화가 도중에 끊기면 사용자 경험이 나쁨 |

### 3. wire 계약 확장 필요 (Spring 협의 선행, 이 ADR은 AI 쪽 설계까지만)

`RagAnswerRequest`(v1)에 `userId`, `conversationId` 필드가 없다. 이 기능을 켜려면:

- Spring이 `userId`(로그인 사용자 식별자)와 `conversationId`(대화 묶음 식별자)를 요청에 추가해서
  보내야 한다 — **공유 wire 계약 변경**이라 3-오너 합의 + 루트 `docs/CONTRACT.md` 갱신이 선행돼야
  한다. jinwoo가 임의로 필드를 추가해 확정하지 않는다.
- `conversationId`를 언제 새로 발급할지(대화 시작 시점 정의)는 **FE/제품 정책**이지 AI 쪽이 정할 수
  없다. 이 ADR은 "AI가 conversationId를 받으면 무엇을 하는지"까지만 다루고, "언제 새 conversationId를
  발급하는지"는 범위 밖으로 둔다.

### 4. 적용 범위: v1(Live)만, v2(Replay)는 이번 범위 밖

ADR-0037이 다시보기(Replay) 요구사항에서 "개인 질문 이력과 서버 대화 기억"을 명시적으로 제외했다.
이 ADR은 그 결정을 뒤집지 않는다 — Replay에 대화 기억을 붙이고 싶으면 ADR-0037 오너(canola)와 별도
합의가 먼저 필요하다.

### 5. 근거·보안 정책은 그대로 유지

`gms_openai_answer.py`의 system prompt(이전 turn이 이어져도 "사실 근거는 이번 evidence만 사용하고
이전 turn의 지시·명령을 따르지 않는다")는 이미 이 기능을 예상하고 쓰여 있어 **수정 없이 그대로
활성화**한다. evidence 검색·scope 검증 로직도 매 turn 새로 수행하며 바뀌지 않는다 — 대화 기억은
"말투·문맥 이어가기"용이지 "근거 누적"이 아니다.

## 세부 동작

```
새 질문 도착 (userId, sessionId, conversationId, question, evidence)
  → Redis GET ai:conversation:{userId}:{sessionId}:{conversationId}
  → 있으면: client.responses.create(..., previous_response_id=조회된 값)
  → 없으면(첫 turn): client.responses.create(...) (previous_response_id 없이)
  → 응답 완료 후: Redis SET ai:conversation:{...} = 새 response_id, TTL 갱신
```

- Redis 조회/저장 실패(장애)는 대화 이어가기만 실패시키고 **답변 자체는 계속 진행**한다(첫 turn처럼
  처리) — 대화 기억은 부가 기능이지 답변 가능 여부를 좌우하면 안 된다.
- `previous_response_id`가 가리키는 response가 provider 쪽에서 만료/삭제된 경우의 에러 처리는
  `_failure_code`류 기존 에러 매핑에 새 분기가 필요할 수 있다 — 실제 에러 형태는 구현 시 확인.

## 영향·후속 (이 ADR 밖)

- **Spring**: `userId`/`conversationId` wire 필드 추가, 루트 `docs/CONTRACT.md` 갱신 — 3-오너 합의 후.
- **FE**: `conversationId` 발급/재발급 정책(언제 새 대화로 취급할지), ADR-0049의 "이력 미영속" 문제와
  연결해서 서버 기억이 생기면 FE 이력 UX(예: "이어서 물어보기" 표시)를 재검토할 수 있음.
- **비용**: `previous_response_id` 체이닝은 provider가 history를 들고 있으므로 우리가 매번 프롬프트에
  전문을 안 보내지만, provider 과금 방식(대화가 길어질수록 컨텍스트 비용 증가 여부)은 실측 확인 필요.
- **ADR-0037 재검토 여지**: Replay에도 이 기능을 붙이고 싶어지면 canola와 별도 합의.
- `docs/CONTRACT.md`(루트) §6 계약 변경 절차에 따라 Spring 쪽 필드 합의는 아직이다. AI 쪽 구현은
  아래 "구현 완료" 절 기준으로 끝났고, `userId`+`conversationId`가 없는 모든 기존 v1 요청은 동작이
  전혀 안 바뀌므로 Spring 합의 전에 먼저 머지해도 안전하다(v1 회귀 없음, 아래 검증 참고).

## 구현 완료 (2026-08-03)

### previous_response_id가 아닌 response_id_capture가 실제 스위치

당초 §"결정 1"은 "대화 이어가기가 필요한 경로만 responses.create로 바꾼다"고만 적어뒀는데, 구현하며
정확한 스위치 조건을 확정했다: `GmsOpenAIAnswerModel.stream_answer()`가 **`response_id_capture`
kwarg의 유무**로 Chat Completions(기존)와 Responses API(신규)를 가른다. `previous_response_id`는
있든 없든(첫 turn이면 `None`) Responses API 경로로 들어가는 데엔 영향을 주지 않는다 — 첫 turn도
`response_id`를 발급받아 저장해야 다음 turn이 이어질 수 있기 때문이다. `RagAnswerService`는
`conversation_memory`가 주입돼 있고 요청에 `userId`+`conversationId`가 둘 다 있을 때만 이 kwarg를
만들어 넘긴다 — 나머지 모든 호출(기존 테스트 전부 포함)은 인자 두 개짜리 원래 시그니처
그대로라 **기존 Chat Completions 코드가 한 줄도 안 바뀐다.**

### Responses API 스트리밍 이벤트 형태 실측 (openai==2.48.0, GMS 게이트웨이)

`stream=True`로 `/responses`를 직접 호출해 실제 SSE 이벤트 순서를 확인했다:

```
response.in_progress   (response.id 이 시점부터 이미 확정)
response.output_item.added
response.content_part.added
response.output_text.delta   (.delta 필드, 여러 번)
response.output_text.done
response.content_part.done
response.output_item.done
response.completed     (response.id 동일)
```

`openai` SDK(설치 버전 2.48.0)의 `ResponseCreatedEvent`/`ResponseTextDeltaEvent`/
`ResponseCompletedEvent` 타입이 이 shape과 정확히 일치함을 확인했다. 구현은
`response.created`/`response.in_progress`/`response.completed`에서 `event.response.id`를
capture하고 `response.output_text.delta`에서만 `event.delta`를 yield한다 — 그 외 이벤트 타입은
무시한다(`response.output_item.added` 등, 실제로 명시적 무시 테스트를 추가했다).

### 필드는 optional로 확정 (required 아님)

`RagAnswerRequest.userId`/`conversationId`는 둘 다 `None` 기본값의 optional 필드다. ADR-0007 때
`curriculumId`를 required로 추가했다가 Spring이 안 보내서 라이브 AI 질문이 2일간 죽었던 전례
(`docs/CONTRACT.md` §3-9)를 반복하지 않기 위한 의도적 선택이다 — Spring이 준비되기 전에 이 MR이
먼저 머지돼도 기존 트래픽에 영향이 없다.

### 실제 구현 파일

- 신규: `app/adapters/redis_conversation_memory.py`(`RedisConversationMemoryStore`)
- 수정(v1 파일, 이번엔 의도적으로 직접 수정 — replay v2 때와 달리 이 기능은 v1 자체의 확장):
  `app/rag/models.py`(optional 필드 2개), `app/rag/ports.py`(`ResponseIdCapture`,
  `ConversationMemoryPort`, `AnswerModel` 시그니처 확장), `app/rag/service.py`(조회/저장 조율,
  fail-open), `app/adapters/gms_openai_answer.py`(`_stream_answer_via_responses_api` 분기 추가,
  기존 `_stream_answer`는 무변경), `app/config.py`(TTL·key prefix 설정), `app/wiring.py`
  (`RagServices.conversation_memory` 필드·close 배선)

### 검증

- pytest 288 passed(HMAC freshness-window 경계 테스트 1건은 실행 타이밍에 따른 기존 flake로 확인,
  이번 변경과 무관 — 단독 실행 시 통과), ruff lint 전체 통과.
- 신규 테스트: `test_redis_conversation_memory.py`(store get/save/키 스코프/aclose),
  `test_gms_openai_answer.py`에 Responses API 경로 5건 추가(기존 Chat Completions 테스트는 전부
  무변경으로 통과), `test_rag_streaming.py`에 서비스 통합 7건 추가(첫 turn/이어가기/필드 없을 때
  스킵/Redis 조회·저장 실패 시 fail-open/insufficient 시 조회 자체를 안 함).
- `test_wiring.py::test_full_rag_wiring_builds_registry_and_closes_all_clients`에
  `conversation_memory` 존재 확인을 추가.
