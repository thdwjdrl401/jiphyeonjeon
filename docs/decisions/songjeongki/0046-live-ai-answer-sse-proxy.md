# ADR-0046: 라이브 AI 질의응답 — 브라우저 SSE 프록시와 ai-api HMAC signer

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택 (BE 구현)
- **일자**: 2026-07-30
- **관련**: [canola/0023 §9](../canola/0023-spring-to-ai-rag-jwt-contract.md)(HMAC 공유 시크릿 합의), [0043](0043-caption-consumer-persistence.md)(자막 영속·raw streamElapsedMs), [0045](0045-live-caption-position-sync-approx-session-ms.md)(근사 세션-ms), [0036](0036-material-embedding-pipeline.md)(콜백 HMAC 패턴), [0009](0009-java21-spring-boot-3.md)(virtual threads·reactive 회피), CONTRACT §2 AI·§3-9, [`ai/ai-api/CONTRACT.md`](../../../ai/ai-api/CONTRACT.md), FE [`docs/frontend/api/LIVE.md`](../../frontend/api/LIVE.md)
- **오너 경계**: BE(송정기) — 브라우저 SSE 엔드포인트·인가·HMAC signer·릴레이 / AI(유채은) — ai-api RAG 구현·HMAC 검증기(구현·배포됨) / FE — SSE 소비·렌더

## 맥락

`ai-api`의 RAG SSE(`POST /internal/v1/rag/answers:stream`)는 구현·배포됐고 HMAC 검증기도 **살아 있다**
(운영 prod에 서명 없이 POST하면 `503`이 아니라 `401 {"detail":"invalid internal credentials"}`).
그런데 **Spring 쪽 signer도, 브라우저용 SSE 프록시도 없어서** 사용자가 질문할 통로가 아예 없었다.
FE는 `httpLiveSessionService.ts:426`·`httpReplayService.ts:20`에서 `notImplemented(...)`(501) 스텁 상태다.

또 FE 명세([`docs/frontend/api/LIVE.md`](../../frontend/api/LIVE.md))가 먼저 잡아 둔 URL·이벤트 스키마가
실제 ai-api 규격과 어긋나 있었다(아래 §결정 1·2에서 정리).

## 결정

### 1. 브라우저 엔드포인트는 `POST /api/live-sessions/{sessionId}/ai/answers/stream` — 경로가 `/stream`으로 끝나는 건 계약이다

FE 명세는 `POST /api/lessons/{lessonId}/ai/questions:stream`(lesson 스코프 + `:stream` 접미사)이었다. 둘 다 바꾼다.

**(a) `:stream` → `/stream`.** `frontend/nginx/default.conf`의

```nginx
location ~ ^/api/.+/stream$ { ... proxy_buffering off; ... }
```

만 `proxy_buffering off`를 적용하고, 그 블록의 주석이 **"SSE 엔드포인트 경로를 `/stream`으로 끝내면 이
블록이 자동 적용(백엔드 라우팅도 동일하게)"** 라고 규약을 못박아 두었다. `questions:stream`은 정규식에
매칭되지 않아 nginx가 토큰을 버퍼링하고 **스트리밍이 그냥 깨진다**(운영에서만, 로컬 Vite 프록시에서는
안 드러나는 종류의 버그다). 규약을 지키는 쪽이 옳다 — nginx를 고쳐 예외를 늘리는 대신 경로를 맞춘다.

**(b) lesson 스코프 → session 스코프.** ai-api는 `lessonId`와 `sessionId`를 **둘 다 필수**로 받고,
자막(CAPTION) evidence는 `sessionId` 범위로 검증한다. 라이브 문맥의 질문은 "이 세션에서 방금 한 말"이
근거이므로 세션이 1차 키다. 반대로 세션을 body에 두고 lesson을 경로에 두면
① 인가 게이트를 세션으로 다시 걸어야 하고 ② 클라가 보낸 세션을 신뢰하게 된다. 세션을 경로에 두면
`lessonId`는 서버가 세션에서 조회해 채우므로 **클라가 다른 강의의 근거를 열람할 여지가 없다**.

### 2. 이벤트는 ai-api 스키마 그대로 릴레이한다(변환 계층 없음)

FE 명세는 `meta`/`delta`/`citation`/`done(status)`/`error`였고 ai-api 실제는
`answer.delta`/`answer.done`/`answer.insufficient`/`answer.error`다. **ai-api 이름·data를 그대로**
브라우저로 흘리고 FE 문서를 실제 스키마로 갱신한다.

- 변환 계층은 정보 손실을 만든다(`sources`의 `PPTX{materialId,page}`·`CAPTION{sttSessionId,startMs,endMs}`를
  FE 명세의 `evidenceId/excerpt/slideNumber` 모양으로 접으면 원본 좌표가 사라진다).
- AI가 이벤트를 추가하면 Spring을 고치지 않아도 FE가 받는다. 프록시가 스키마의 이중 소유자가 되지 않는다.
- 예외는 하나뿐이다: **프록시 자신의 실패**를 알릴 때 같은 모양의 `answer.error`를 만들어 보낸다
  (`code=PROXY_STREAM_INCOMPLETE|PROXY_UPSTREAM_FAILED`). FE 분기를 하나로 유지하기 위함이다.

### 3. 인가는 세션 참가자 게이트 하나 — 자막 리로드와 동형

`LiveAccessGuard.requireCanAccess(sessionId, userId)`: 소유 강사 또는 해당 커리큘럼의 ACTIVE 수강생.
없는 세션 404 `LIVE_SESSION_NOT_FOUND`, 미수강 403 `LIVE_SESSION_FORBIDDEN` — `CaptionController`·
`ChatController`와 **같은 게이트·같은 코드**다. 인가 실패 시 ai-api를 호출하지 않는다(비용·근거 유출 방지).

`live_session.aiQnaEnabled` 플래그로 추가 게이트를 걸지 **않는다** — 이번 범위는 경로 개통이고,
기능 스위치 정책(누가 언제 끄나)은 별도 결정이다. 필요해지면 여기에 409를 추가한다.

### 4. `contextTimeMs`는 해당 세션 **최신 자막 행의 raw `streamElapsedMs`**

ai-api 규격은 "0 이상의 **최신 STT attempt-local `streamElapsedMs` 좌표**"다. 세션-ms가 아니다.
우리는 이미 `core.live_caption`에 raw `stream_elapsed_ms`를 **변환 없이** 영속한다(ADR-0043).
따라서 `findFirstBySessionIdOrderByOccurredAtDescIdDesc(sessionId).streamElapsedMs`가 곧 규격 값이다.

- **앵커 문제가 없다**: CONTRACT §3-4가 금지한 `streamElapsedMs→세션ms` 변환을 하지 않는다. attempt가
  retry로 갈려도 "가장 최근 행"은 곧 "가장 최근 attempt의 최신 좌표"라 ai-api가 기대하는 축과 같다.
- ADR-0045의 근사 `sessionMs`는 **표시용**이라 여기 쓰지 않는다(변환값을 AI에 보내면 근거 검색이 어긋난다).
- 자막이 하나도 없으면 **0**(라이브 시작 직후·자막 비활성 세션). ai-api는 0 이상이면 받는다.

### 5. 서명 — rawBody를 한 번만 직렬화해 그 바이트로 서명하고 그 바이트를 보낸다

```
X-Internal-Signature: base64(HMAC-SHA256(AI_INTERNAL_SECRET, rawBody))
```

`RagAnswerHttpClient`가 `writeValueAsBytes(...)`로 **한 번** 만든 `byte[]`를 서명하고 같은 배열을
`BodyPublishers.ofByteArray(...)`로 보낸다. 객체를 다시 직렬화해 전송하면(필드 순서·공백·escape가 달라져)
서명이 깨져 401이 난다 — 이 계열에서 가장 흔한 버그라 계약 테스트로 못박았다(`signs_the_exact_raw_body_it_sends`).

- 시크릿은 `AI_INTERNAL_SECRET`이다. 콜백/download-url의 `AI_CALLBACK_SECRET`과 **다른 값**이다
  ([`docs/ai/CONTRACT.md` §3.2](../../ai/CONTRACT.md)). 계산 자체는 기존 `AiCallbackVerifier`와 같은
  HMAC이라 `HmacSha256` 유틸로 뽑아 공유한다.
- `issuedAtMs`는 **전송 직전** `System.currentTimeMillis()`. 수신 시각과 60초 이상 차이나거나 5초 초과
  미래면 ai-api가 401이므로, 요청 조립 시점이 아니라 전송 시점에 찍어야 한다.
- body는 **정확히 6필드**(`requestId`·`lessonId`·`sessionId`·`question`·`contextTimeMs`·`issuedAtMs`).
  ai-api가 `extra="forbid"`라 하나만 늘어도 400이다. UUID는 `UUID.toString()`이 소문자 canonical이다.
- `question`은 **trim하지 않는다**. `requestId`는 **서버 생성 UUID** — 클라가 정하면 재사용으로 409를 맞는다.

### 6. 스트리밍은 JDK `HttpClient` + `SseEmitter` + virtual thread (WebFlux 도입 안 함)

backend는 JPA·blocking 모놀리스이고 ADR-0009가 **reactive/JPA 혼합 회피**를 결정했다. WebClient를 들이면
webflux 스택 전체가 따라온다. 대신:

- `HttpClient.send(..., BodyHandlers.ofInputStream())` — **응답 헤더까지 블로킹**하고 body는 스트림으로 남는다.
  덕분에 "스트림 시작 실패"를 컨트롤러가 SSE 헤더를 내보내기 **전에** 알 수 있다(→ 평범한 JSON 오류로 매핑).
- 200이면 `SseEmitter`를 반환하고 virtual thread 하나가 업스트림을 줄 단위로 읽어 프레임 경계마다 즉시
  `send`한다(`SseEmitter.send`가 프레임마다 flush). 버퍼링 없음.
- **취소 전파**: `onCompletion`/`onTimeout`/`onError`에서 업스트림 `InputStream`을 닫는다 = JDK HttpClient가
  교환을 취소한다. 브라우저 쓰기가 `IOException`이면 릴레이가 중단되고 같은 경로로 업스트림이 닫힌다.
  닫지 않으면 ai-api의 process-local active request 슬롯이 계속 잡혀 503을 유발한다.
- 브라우저 emitter 타임아웃 = 업스트림 스트림 타임아웃(`liveclass.ai.stream-timeout`, 기본 5분). 짧게 잡으면
  정상 응답이 중간에 끊긴다.

### 7. 에러 매핑 — 업스트림 상태코드를 그대로 흘리지 않는다

| ai-api | 브라우저 | code |
|---|---:|---|
| 503(RAG 미배선·active 한도 초과) 또는 연결 실패 | **503** | `AI_ANSWER_UNAVAILABLE` |
| 409(requestId 재사용) | **409** | `AI_ANSWER_REQUEST_CONFLICT` |
| 400·401·406·그 밖의 5xx | **502** | `AI_ANSWER_UPSTREAM_REJECTED` |
| SSE 시작 **후** 실패·terminal 없이 종료 | 200 유지 | `answer.error` 이벤트(`PROXY_UPSTREAM_FAILED`·`PROXY_STREAM_INCOMPLETE`, `retryable:true`) |

**401을 401로 흘리지 않는 게 핵심이다.** ai-api의 401은 우리 서명·시크릿·시계 문제이지 사용자 세션 문제가
아닌데, 브라우저가 401을 받으면 FE(`client.ts`)가 세션 만료로 보고 로그아웃 처리한다. SecurityConfig가
`/error`를 permitAll로 열어 둔 것과 같은 이유다.

### 8. 오류 봉투는 Content-Type을 명시한다 (SSE Accept와의 충돌)

SSE 클라이언트는 `Accept: text/event-stream`을 보낸다. 이 상태에서 403/404/400이 나면 Spring이 JSON
오류 봉투를 쓸 미디어 타입을 협상하지 못해 **원래 예외가 그대로 새어나간다**(ServletException/500).
`ErrorResponses.of(...)`로 `application/json`을 preset해 협상을 건너뛴다 — `LiveExceptionHandler`·
`ValidationExceptionHandler`·`UnhandledExceptionHandler`에 적용했다. 기존 JSON 클라이언트에는 무변화다.

### 9. 이번 범위는 **라이브 전용**이다 — 다시보기 AI는 후속

FE에 `askReplayAi(lessonId, question, sessionMs)`(501 스텁)가 있지만 이번에 열지 않는다.

- ai-api는 `sessionId`를 **필수**로 받고 자막 evidence를 그 세션 범위로 검증한다. 다시보기는 "그 레슨의
  종료된 세션"을 골라야 하는데(세션이 여럿일 수 있다) 선택 규칙이 정해져 있지 않다.
- `contextTimeMs` 축이 다르다. 다시보기의 위치는 **세션-ms**(HLS PDT 기준, ADR-0039)인데 ai-api는
  attempt-local `streamElapsedMs`를 요구한다. 라이브에서는 "최신 자막 행"이 그 좌표라 변환이 필요 없지만,
  다시보기는 임의 시점이라 **세션-ms→streamElapsedMs 역변환이 필요하고 그 앵커가 아직 없다**
  (CONTRACT §3-4의 후속 공유 계약 대상).

따라서 다시보기 AI는 앵커 계약이 서고 나서 별도 엔드포인트(`/api/lessons/{lessonId}/ai/answers/stream`
또는 세션 지정형)로 연다. 그때까지 FE의 replay AI는 501 스텁을 유지한다.

## 결과

**얻는 것**

- 사용자가 라이브 중 질문할 통로가 열린다. ai-api 인증기가 이미 배선돼 있어 시크릿만 맞으면 실동작한다.
- 규격 위반의 흔한 함정(재직렬화 서명 불일치, extra 필드, 세션ms 오전송, nginx 버퍼링)이 전부 테스트로 고정된다.
- 프록시가 스키마를 소유하지 않아 AI가 이벤트를 늘려도 Spring 변경이 필요 없다.

**치르는 것**

- 릴레이 요청 하나당 virtual thread + 소켓 하나가 스트림 동안 유지된다. 한도·요금 정책(사용자당 동시 질문 수)은
  아직 없다 — ai-api의 process-local active 한도(503)에 기대는 상태다. 후속 결정 대상.
- 스트림 재연결·이어받기가 없다. 끊기면 새 `requestId`로 다시 질문한다(ai-api도 replay 멱등키가 아니라고 못박음).
- 다시보기 AI는 여전히 막혀 있다(위 §9).

## 계약 테스트

`backend/src/test/java/com/liveclass/live/LiveAiAnswerContractTest.java` — ai-api를 JDK `HttpServer` 목으로
세워(실제 ai-api·WireMock 불필요) 다음을 고정한다. 하네스 판단은 [POLICY](../../harness/POLICY.md)의
"FE/BE·Spring↔AI 런타임 계약 → 계약 테스트 필수"에 해당한다.

| 검증 | 테스트 |
|---|---|
| 서명이 실제 전송 바이트와 일치 | `signs_the_exact_raw_body_it_sends` |
| body 6필드만·소문자 UUID·질문 무-trim·신선한 issuedAtMs | `request_body_has_only_the_six_contract_fields` |
| contextTimeMs = 최신 자막 raw streamElapsedMs / 자막 없으면 0 | `context_time_ms_is_the_latest_caption_stream_elapsed_ms`·`..._is_zero_when_the_session_has_no_caption` |
| delta n개 + terminal 1개 그대로 릴레이 | `relays_ai_api_events_verbatim`·`relays_insufficient_terminal_as_is` |
| terminal 없이 끊기면 answer.error | `emits_answer_error_when_upstream_ends_without_a_terminal` |
| 인가(비참가자 403·미인증 401·없는 세션 404·수강생 허용) | `non_participant_is_forbidden_and_ai_api_is_never_called` 외 3건 |
| 입력 검증 400 | `blank_or_too_long_question_is_400` |
| 에러 매핑 503/409/401→502/400→502 | `upstream_*` 4건 |

## 의존성·후속

1. **운영 시크릿**: `docker-compose.prod.yml`의 backend에 `AI_INTERNAL_SECRET`을 추가했다. 값이 ai-api의
   것과 **같아야** 한다(다르면 401 → 502 `AI_ANSWER_UPSTREAM_REJECTED`). `/etc/liveclass/.env.prod`에
   이미 있는 값을 그대로 참조한다.
2. **FE 배선**: `httpLiveSessionService.ts`의 501 스텁을 이 엔드포인트로 교체(요청·이벤트 형식은
   [`docs/frontend/api/LIVE.md` §10.1](../../frontend/api/LIVE.md)).
3. **다시보기 AI**: 시간 앵커 공유 계약 이후(§9).
4. **비용·한도 정책**: 사용자/세션당 동시 질문 제한, 질문 로깅·강사 집계(FE 명세의 question-pins)는 후속.
