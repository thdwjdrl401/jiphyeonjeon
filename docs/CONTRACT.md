# CONTRACT.md — 공유 계약 (정본)

> 📍 하네스 개요: [docs/harness/README.md](harness/README.md) · 정본 규칙: [AGENTS.md](../AGENTS.md) · 아키텍처: [ARCHITECTURE.md](ARCHITECTURE.md)
> · AI endpoint·queue·stream·tunnel 지도: [AI 통신 계약](ai/CONTRACT.md)
>
> **FE↔Spring**, **Spring↔AI(RabbitMQ/HTTP/LiveKit AgentDispatch/Redis Streams)**,
> **EC2 AI↔GPU AI(HTTP)** 가 동시에 지켜야 어긋나지 않는 계약. 한쪽이 바꾸면 다른 쪽이 깨지는 항목만.
> (구 화상회의 명세 [SPEC.md](legacy/SPEC.md)는 참고용 — [decisions/songjeongki/0003](decisions/songjeongki/0003-greenfield-redesign.md))

---

## 1. 필드명 규칙 — camelCase 통일
> 근거: [decisions/songjeongki/0001](decisions/songjeongki/0001-field-name-camelcase.md) (팀 자체 컨벤션)
- **API JSON·이벤트 필드명은 `camelCase`**. 예: `curriculumId`·`lessonId`·`sectionId`·`startMs`·`hlsManifestKey`·`isPublished`.
- **DB 컬럼은 snake_case 허용**, DTO/응답/이벤트로 노출되는 순간 camelCase.

## 2. REST API (`/api`, Spring 소유)
| 도메인 | 예시 | 비고 |
|---|---|---|
| 인증 | `POST /auth/login`·`/auth/signup`·`/auth/logout`·`GET /auth/email-availability` | 인증 식별자는 **`email`**(구현됨, `loginId` 아님). 상태코드: 생성 201·중복 409·인증실패 401·권한 403. **HttpOnly 쿠키 세션(Redis 저장)** — FE는 `withCredentials`, `Authorization: Bearer` 미사용. 변경요청 CSRF 토큰([decisions/songjeongki/0014](decisions/songjeongki/0014-auth-redis-session-cookie.md)). 내 계정: `PUT /me/profile-image`(전원)·`PUT /me/display-name`(표시 이름만, `email`·역할 불변)·`GET·PUT /me/instructor-profile`(강사 전용 소개·전문분야, 비강사 403)·`PUT /me/password`(현재 비번 불일치 401)·`DELETE /me`(탈퇴). 탈퇴는 **소프트 삭제**(status WITHDRAWN, 데이터 보존)이고 진행 중 라이브가 있으면 409, 탈퇴 시 이메일을 tombstone 처리해 **같은 이메일 재가입 허용**([decisions/songjeongki/0031](decisions/songjeongki/0031-account-profile-security.md)) |
| 카탈로그 | `GET /curriculums`·`GET /curriculums/{id}` | 검색·필터·페이지네이션. **응답에 `viewerContext`(관계·allowedActions) 포함(구현됨)** — 비로그인도 호출 가능하고, 쿠키가 있으면 그 사용자 기준으로 채운다. 상세는 `enrollmentPolicy`와 목차 레슨별 `liveSession`·`access`까지. ([decisions/songjeongki/0026](decisions/songjeongki/0026-catalog-viewer-context.md)) |
| 커리큘럼(강사) | `POST/PATCH/DELETE /instructor/curriculums`·`.../sections`·`.../curriculum/order` | 소유권 검증. **삭제는 초안만** — `DELETE /instructor/curriculums/{id}`는 `lifecycleStatus=DRAFT`일 때만 204이고, 공개·보관 상태는 409 `CURRICULUM_STATE_CONFLICT`로 거절한다(보관으로 유도). 섹션·레슨은 DB 캐스케이드로 함께 사라진다 ([decisions/seominkyeong/0001](decisions/seominkyeong/0001-draft-only-curriculum-delete.md)). **섹션 삭제는 비어 있을 때만** — 레슨이 남아 있으면 409 `SECTION_NOT_EMPTY` |
| 강의 | `POST /instructor/sections/{id}/lessons`·`PATCH /instructor/lessons/{id}`·`GET /lessons/{id}` | 상태 필드는 **어디서나 `status`**(목차·관리 응답 동일, `lessonStatus` 아님). 값: DRAFT/AI_NOT_READY/READY/PUBLISHED. 수강생용 `GET /lessons/{id}`는 소유권이 아니라 **수강 관계**로 연다 — 미수강 403 `ENROLLMENT_REQUIRED`, 수강 중이라도 미게시 레슨은 404([decisions/songjeongki/0029](decisions/songjeongki/0029-lesson-detail-and-display-name.md)). **강사 저작 화면은 공개 카탈로그가 아니라 강사 엔드포인트로 읽는다** — `GET /instructor/lessons/{id}`는 DRAFT여도 열리고 그 레슨의 **`liveSession`(sessionId·status·scheduledAt, 없으면 null)을 함께 준다**([decisions/songjeongki/0041](decisions/songjeongki/0041-instructor-authoring-reads-and-autosave.md)) |
| 자료 | `POST /instructor/lessons/{id}/materials` (PPTX) | presigned→MinIO. **영상 업로드 없음**. 본문은 `{"assetId":"..."}`(먼저 에셋으로 올린 PPTX를 연결, multipart 아님). 소유 강사만(비소유 403·없는 레슨 404), 성공 **201** `{materialId, assetId, fileName, status}`. 같은 (레슨,에셋) 중복 연결 **409** `MATERIAL_ALREADY_ATTACHED`(DB 부분 유니크 인덱스로 동시요청도 차단), 잘못된 에셋(없음·kind 불일치·미완료·업로더 불일치) **400** `MATERIAL_INVALID`. 레슨 상세(`GET /lessons/{id}`)·커리큘럼 상세·**강사 관리용 `GET /instructor/lessons/{id}`**의 `materials`는 연결된 활성 자료로 채워지되, **커리큘럼 상세는 ENROLLED·OWNER_INSTRUCTOR에게만 노출**(게스트·미수강자는 빈 목록). **삭제** `DELETE .../materials/{materialId}`(소프트, 멱등)·**다운로드** `GET .../materials/{materialId}/download`(presigned 302). 자료 응답에 **`embeddingStatus`**(PENDING/PROCESSING/READY/FAILED, [0036](decisions/songjeongki/0036-material-embedding-pipeline.md)) — 임베딩 파이프라인(outbox→RabbitMQ→AI→pgvector→콜백)은 스위치(`material.embedding.enabled`) 뒤, 기본 off라 지금은 READY. **AI 콜백** `POST /api/internal/ai/callbacks`(§3-2, HMAC 서명·inbox 멱등)로 상태 확정 ([decisions/songjeongki/0035](decisions/songjeongki/0035-lesson-material-attach.md), [0036](decisions/songjeongki/0036-material-embedding-pipeline.md)). **커리큘럼-레벨 자료(ADR-0042)**: 같은 계약을 스코프만 달리해 `POST/DELETE /instructor/curriculums/{id}/materials[/{materialId}]`·`GET .../download`으로 제공(레슨 자료와 대칭 — 201·409·400·204·302 동일, 같은 `material_asset` 테이블). 커리큘럼 공통 자료는 **강사 관리용 `GET /instructor/curriculums/{id}`의 `materials`**와 공개 상세(`GET /curriculums/{id}`, ENROLLED·OWNER_INSTRUCTOR 게이트)에 함께 노출된다 ([decisions/songjeongki/0042](decisions/songjeongki/0042-curriculum-material-attach-and-embedding-scope.md)) |
| 에셋 | `POST /assets/upload-requests` → presigned `PUT` → `POST /assets/{id}/complete` | 바이트는 앱 서버를 통과하지 않는다. 받은 `assetId`를 도메인 요청에 실어 보낸다(커리큘럼 `thumbnailAssetId`, 프로필 `assetId`, 레슨 자료 `assetId`). kind별 발급: **PROFILE_IMAGE는 인증된 누구나**, **THUMBNAIL·MATERIAL은 강사만**(학생 403). MATERIAL은 **PPTX만·50MiB**, 이미지 kind는 jpeg·png·webp·5MiB — 형식·크기 위반은 400 ([decisions/songjeongki/0023](decisions/songjeongki/0023-asset-presigned-upload.md), [0035](decisions/songjeongki/0035-lesson-material-attach.md)) |
| 다시보기 | `GET /lessons/{id}/playback` · `GET /lessons/{id}/playback/manifest` · `POST /instructor/lessons/{id}/replay-review/publish` · `POST /instructor/lessons/{id}/replay-review/withdraw` · `POST /webhooks/livekit` | **라이브 되감기·종료 후 재생 API 구현됨**([decisions/choinhoo/0001](decisions/choinhoo/0001-live-replay-playback-api.md), [decisions/songjeongki/0039](decisions/songjeongki/0039-replay-playback-api.md)). metadata 응답은 `{lessonId, videoAssetId, sessionId, startedAt, liveSessionStatus, currentSessionMs, sessionOffsetMs, durationMs, source}`이고 `source`는 `{url, availableFromMs, availableToMs}` 또는 manifest 생성 전이면 `null`이다. **STARTING은 준비 상태 조회만 허용하고, manifest가 이미 있어도 `source=null`이며 manifest endpoint는 409 `RECORDING_STARTING`이다. 실제 HLS source는 원자적 LIVE 전환 뒤에만 공개한다.** source는 하나다 — 라이브 중 재생목록은 `#EXT-X-ENDLIST` 없이 자라는 EVENT 목록이라 라이브 엣지와 세션 처음까지의 seek을 한 목록이 동시에 준다. `url`은 인증된 manifest endpoint이며 `application/vnd.apple.mpegurl`·`Cache-Control: no-store`; 그 본문의 일반 세그먼트와 `EXT-X-MAP/KEY` URI를 presigned GET으로 재작성한다. **라이브 중에는 `#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL`(기본 60s, `video.playback.can-skip-until`)로 델타 재생목록을 광고하고, 플레이어가 `_HLS_skip=YES`로 다시 물으면 경계보다 오래된 세그먼트를 `#EXT-X-SKIP:SKIPPED-SEGMENTS=N`으로 생략한다**(RFC 8216bis §6.2.5.1). 생략은 삭제가 아니라 병합 지시라 `EXT-X-MEDIA-SEQUENCE`가 불변이고 플레이어 진행 바는 강의 전체를 유지한다. 종료 후 재생목록은 ENDLIST가 있어 플레이어가 다시 받지 않으므로 델타를 쓰지 않는다. 학생은 활성 수강 + 레슨 PUBLISHED가 필수이고, 세션 `STARTING/LIVE/ENDING` 중에는 `replayStatus`와 무관하게 metadata를 조회하며 실제 재생은 LIVE/ENDING부터 한다. 종료 후에는 자산 READY + replay PUBLISHED만 시청한다. 소유 강사는 게시 전에도 미리보기한다. 첫 PDT − 세션 시작시각을 `sessionOffsetMs`로 요청마다 계산한다. 세그먼트 URL TTL은 `video.playback.segment-url-ttl`(기본 **6h**) — **델타는 옛 세그먼트 URL을 다시 주지 않으므로 강의 길이보다 짧으면 오래 시청한 학생의 되감기가 403이 된다**. 세그먼트는 공개 도메인(`video.playback.public-endpoint`)으로 서명해 nginx `/recordings/`로 서빙하며, backend가 매니페스트를 읽는 내부 주소(`livekit.egress.s3-endpoint`)와 다르다(SigV4가 Host를 서명에 포함). manifest 생성 지연 409 `RECORDING_STARTING`, 종료 자산 미준비·manifest 유실 409 `REPLAY_NOT_READY`, 스토리지 장애 503 `PLAYBACK_STORAGE_UNAVAILABLE`; 세그먼트 403/장시간 일시정지 뒤에는 같은 URL을 다시 로드한다. 게시·철회는 소유 강사만, 둘 다 204 멱등이며 게시에는 READY가 필요하고 라이브 중 철회는 409 `REPLAY_WITHDRAW_WHILE_LIVE`다. 검수 데이터 저장(`PUT .../replay-review`)은 CP2·CP3 산출물이 없어 미구현. LiveKit webhook은 JWT 검증 후 자산 READY/FAILED와 녹화 통계를 멱등 확정한다([0034](decisions/songjeongki/0034-egress-completion-webhook.md)). |
| 학습 | `GET /lessons/{id}/learning-context`·`PUT /lessons/{id}/progress`·`POST .../bookmarks` | **구현됨**(learning 배선, [decisions/songjeongki/0033](decisions/songjeongki/0033-learning-progress-wiring.md)). 수강자만(미수강 403 `ENROLLMENT_REQUIRED`, 없는 레슨 404). 진도율은 **클라이언트 계산·서버 저장**(0~100), 90% 넘으면 완료(sticky), `clientUpdatedAt`으로 순서역전 방어. 북마크는 멱등. **카탈로그 `progress`는 이제 활성 수강자에게 채워진다**(완료 레슨 수 기준, 상세·내 수강 목록). watched_ranges 정교화는 후속 |
| 내 수강·대시보드 | `GET /me/enrollments`·`GET /me/learning-summary`·`GET /instructor/dashboard-summary` | **항목마다 커리큘럼 카드 동봉(구현됨)** — 목록을 받고 커리큘럼을 건건이 다시 조회하지 않도록. **학습 요약(구현됨)**: 활성 수강 전반의 `inProgressCurriculumCount`·`completedCurriculumCount`·`averageProgress`(0~100)·`completedLessonCount`와 `todayLiveSession`(가장 이른 예정/진행 라이브, 없으면 null). 로그인 필요, 비학생·수강 없음은 0 요약. **강사 대시보드 요약(구현됨)**: `GET /instructor/dashboard-summary` — `totalCurriculumCount`·`publishedCurriculumCount`·`upcomingLiveCount`·`totalEnrolleeCount`와 `todayLiveSession`([decisions/songjeongki/0041](decisions/songjeongki/0041-instructor-authoring-reads-and-autosave.md)). 소유 모듈은 curriculum |
| 자막/용어 | `GET /lessons/{id}/transcript`·`/glossary` · **`GET /live-sessions/{sessionId}/captions`** | transcript·glossary는 게시본(core). **라이브 자막 리로드(구현됨, CAPTION-01/[ADR-0045](decisions/songjeongki/0045-live-caption-position-sync-approx-session-ms.md))**: 저장된 `core.live_caption`을 세션-ms 순으로 반환하며 각 항목은 WS 델타/종료 payload와 **같은 필드**(`type`·`sttSessionId`·`sequence`·`lastSequence`·`streamElapsedMs`·근사 `sessionMs`·`text`·`reason`·`occurredAt`)다. 인가는 세션 참가자(소유 강사/활성 수강생, 미참가 403). FE가 새로고침·재연결 뒤 WS 누적기에 그대로 시드해 자막을 복원한다. |
| AI | **`POST /live-sessions/{sessionId}/ai/answers/stream`(SSE, 구현됨)** · `/lessons/{id}/ai/terms:explain` | **라이브 AI 질의응답(AI-QUESTION-01, [ADR-0047](decisions/songjeongki/0047-live-ai-answer-sse-proxy.md))**: 요청 `{question}`(1~4,000자, 서버가 trim하지 않음)만 받고 `lessonId`·`contextTimeMs`·`requestId`는 **서버가 채운다**(클라 입력 신뢰 금지). 응답은 `text/event-stream`으로 **ai-api 이벤트를 변환 없이 그대로 릴레이**한다 — `answer.delta{requestId,text}` 0개 이상 + `answer.done{requestId,sources}`\|`answer.insufficient{requestId,message}`\|`answer.error{requestId,code,message,retryable}` **정확히 하나**(§3-9). 인가는 세션 참가자(소유 강사/활성 수강생) — 자막 리로드와 같은 게이트(미참가 403 `LIVE_SESSION_FORBIDDEN`, 없는 세션 404). **경로가 `/stream`으로 끝나는 것은 계약이다** — `frontend/nginx/default.conf`의 `location ~ ^/api/.+/stream$`만 `proxy_buffering off`를 적용하므로 다른 접미사(`:stream` 등)면 운영에서 스트리밍이 깨진다. 오류(스트림 **시작 전**): 503 `AI_ANSWER_UNAVAILABLE`(ai-api 503·연결 실패)·409 `AI_ANSWER_REQUEST_CONFLICT`·502 `AI_ANSWER_UPSTREAM_REJECTED`(ai-api 400/401/406 등). **업스트림 401을 401로 흘리지 않는다**(FE가 세션 만료로 오해). 시작 **후** 실패는 상태코드를 바꾸지 않고 `answer.error`(`PROXY_UPSTREAM_FAILED`·`PROXY_STREAM_INCOMPLETE`)로 알린다. 다시보기(replay) AI는 시간 앵커 계약 전이라 **미구현**(ADR-0047 §9). 용어 설명(`terms:explain`)은 미구현 |
| 퀴즈 | `GET /lessons/{id}/quizzes`·`POST /quizzes/{id}/attempts` | 결정론 채점 |
| 채팅 | `GET/POST /live-sessions/{sessionId}/messages` | **세션 키잉(구현됨)**, 본문도 세션 기준. 가명, WS 실시간 + REST 보완 |
| 라이브 | `POST /instructor/live-sessions/{id}/preflight` · `GET /instructor/live-sessions/{id}/preflight/readiness` · `POST /instructor/live-sessions/{id}/token` · `POST /live-sessions/{id}/start` · `GET /live-sessions/{id}/start-status` · `POST /live-sessions/{id}/end` | LiveKit token은 **소유 강사 WebRTC 송출 전용**이다. 활성 수강생에게도 발급하지 않으며 학생은 `GET /lessons/{id}/playback`의 HLS source로만 시청한다([ADR-0032](decisions/songjeongki/0032-media-playback-hls-only.md)). 학생의 token 요청은 역할 게이트 403, 비소유 강사는 403 `LIVE_SESSION_FORBIDDEN`이며 구 공용 경로 `POST /live-sessions/{id}/token`은 제공하지 않는다. preflight prepare는 **200** `{sessionId,roomName,roomSid}`. 강사 FE가 token으로 실제 room에 연결해 microphone을 publish한 뒤 readiness를 조회하며 **200** `{ready,instructorPresent,microphonePublished,microphoneMuted,instructorMicrophoneTrackCount,unexpectedMicrophonePublishers}`; `ready=true`는 소유 강사·정확히 1개인 unmuted microphone·다른 microphone publisher 없음이다. start는 readiness를 다시 검사하고 **202** `{operationId,sessionId,status:"STARTING"}`를 반환한다(이미 STARTING이면 같은 active operation, LIVE면 `status:"LIVE"`). 상태 조회는 optional `operationId` query와 **200** `{operationId,attemptStatus,step,failureCode,failureMessage,session}`이며 attemptStatus는 `IN_PROGRESS|SUCCEEDED|FAILED`, step은 `ACCEPTED|STT_DISPATCHED|EGRESS_STARTING|EGRESS_READY|PUBLISHER_RECHECK|LIVE|FAILED`. 소유권 위반 403, 없는 세션 404, preflight/상태/recording 조건 위반은 409 `LIVE_SESSION_STATE_CONFLICT`, LiveKit room 준비·participant 조회 실패는 502 `LIVE_ROOM_CONTROL_FAILED`이며 이를 마이크 미준비 409로 숨기지 않는다. 시작 실패의 안정 code는 상태 응답의 `failureCode`(`STT_DISPATCH_FAILED|STT_READINESS_GATE_UNAVAILABLE|EGRESS_START_FAILED|EGRESS_NOT_READY|EGRESS_FAILED|EGRESS_ABORTED|EGRESS_LIMIT_REACHED|INSTRUCTOR_NOT_PUBLISHING|START_FAILED`)로 전달한다. 상세: [ADR-0002](decisions/choinhoo/0002-live-start-egress-stt-orchestration.md). |

## 3. 내부 계약 (확정 인터페이스)

### 3-1. Spring → AI 배치 잡 (RabbitMQ)
자료 임베딩 잡 envelope(정본은 코드 `InstructorCurriculumService`): 레슨 스코프는 `{ taskType, materialId, assetId, lessonId, curriculumId, fileName, policy{embedModel}, contractVersion }`. taskType: `PPTX_EMBED`(자료 임베딩)·`EMBED_DELETE`(자료 삭제 시 chunk 제거) 등. **커리큘럼 스코프(ADR-0042)**: 레슨이 없으므로 `lessonId` 대신 `scope: "CURRICULUM"`을 싣고 `curriculumId`만 준다(레슨 잡은 `scope` 미포함 = 암묵적 `LESSON`). 워커는 `scope`로 RAG 적재 범위를 정한다 — 이 계약 진화(스코프별 필수 필드)를 소비하는 워커 측 배선은 후속(ai-worker `PptxEmbedJob`의 `lessonId` optional화 필요, `material.embedding.enabled` 기본 off라 미배선 상태에서 무회귀). (라이브 STT는 배치 아님 — Redis Streams §3-4. 트랜스코드는 없음 — VOD=Egress 녹화, [decisions/songjeongki/0010](decisions/songjeongki/0010-self-host-vod.md)) **outbox**로 발행 신뢰성, 실패는 **DLQ**. **워커 파일 접근(B안, 주문형 발급)**: envelope에 파일 위치·URL을 싣지 않는다. 워커가 잡 처리 **직전에** `POST /api/internal/ai/materials/download-url`(본문 `{assetId}`, §3-2와 동일 HMAC 서명)로 갓 서명된 presigned GET URL을 받아 스토리지에서 직접 읽는다 — 자격증명을 워커에 두지 않고, 사용 직전 발급이라 TTL 만료와 무관. chunk 정책(chunkSize·overlap)은 워커 설정 소유(envelope의 `policy`는 `embedModel`만). 상세: [decisions/songjeongki/0036](decisions/songjeongki/0036-material-embedding-pipeline.md).

### 3-2. AI → Spring callback (HTTP, 서명) — 구현됨
`POST /api/internal/ai/callbacks` — permitAll이되 **HMAC-SHA256 서명이 실질 인증**이다(egress webhook 0034와 동일 패턴). 워커가 공유 시크릿(`ai.callback-secret`)으로 **원시 바이트 body**를 서명해 `X-Signature`(base64) 헤더에 실어 보내고, 검증 실패는 401. body: `{ eventId, eventType, jobId, materialId, lessonId, status }`(미지의 필드는 무시). Spring은 `external_event_inbox`에 `(source=ai-worker, eventId)` 복합키로 삽입해 **멱등** 처리(중복이면 무시). eventType → 자료 임베딩 상태 매핑: `MATERIAL_EMBEDDED`→READY, `MATERIAL_EMBED_FAILED`→FAILED, `MATERIAL_EMBEDDING`→PROCESSING, 그 외는 inbox에만 남기고 상태 불변. 코드: `aiintegration/service/AiCallbackService.java`·`web/AiCallbackVerifier.java`. 상세: [decisions/songjeongki/0036](decisions/songjeongki/0036-material-embedding-pipeline.md).

### 3-3. Spring → realtime-agent (LiveKit explicit AgentDispatch) — AI 구현됨, Spring Phase 4a 구현
Spring은 LiveKit room·권한·생명주기를 소유하고, realtime-agent는 Worker 등록과 배정된 STT job을 소유한다. Java의 `agentName`과 Python의 `STT_AGENT_NAME`은 정확히 같아야 하며 assigned/connected room은 모두 `session-{sessionId}`여야 한다. 근거: [ADR-0025](decisions/canola/0025-realtime-agent-spring-handoff-contract.md).

dispatch metadata는 최대 4,096 UTF-8 byte의 JSON object다. 아래 네 필드만 허용하며 알 수 없는/중복/누락 필드는 agent가 외부 자원을 열기 전에 거부한다.

| 필드 | 계약 |
|---|---|
| `contractVersion` | 문자열 `"1"` |
| `sessionId`, `lessonId` | 소문자 canonical UUID 문자열 |
| `correlationId` | `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}` |

`instructorIdentity`는 넣지 않는다. Spring은 remote microphone publisher가 강사 한 명뿐이도록 room 권한을 보장하고, agent는 두 번째 publisher를 발견하면 fail-closed 처리한다. Spring은 dispatch/job ID를 저장하고 동일 start retry에서 기존 dispatch를 재사용하며, assignment/running 확인·assignment timeout·capacity failure·취소·정리를 멱등 처리한다. 가용 Worker가 없거나 모두 FULL이면 job은 pending이다.

목표 상태에서는 `captionEnabled=true`인 라이브의 시작에서 dispatch 생성 자체나 pending을 성공으로
간주하지 않는다.
Spring은 현재 job의 `JS_RUNNING`, 비어 있지 않은 job/worker/participant ID, 같은 room의 agent
participant 연결만으로도 성공 처리하지 않는다. 같은 job이 §3-5 목표 v2의 필수 `STT_READY`를
보내고 Spring이 이를 영속한 뒤 Egress를 준비하며, LIVE 직전에 같은 job의 RUNNING·READY 유효성을
다시 검증해야 `LIVE`로 전환한다. 시작 전 pending/timeout/failure는 start attempt를 실패시키며,
이미 `LIVE`가 된 뒤의 STT 장애만 자막 `DEGRADED`로 격리한다. 별도 health endpoint는 실제 job
배정과 용량을 예약하거나 배정된 job의 model·Redis·audio readiness를 증명하지 못하므로 이 gate를
대체하지 않는다. 상세 시작 순서와 readiness 조건은
[ADR-0002](decisions/choinhoo/0002-live-start-egress-stt-orchestration.md)를 따른다.

단계적 rollout 예외로 `live.stt.assume-ready=true`(초기 기본값)인 동안에는 explicit named
Dispatch **생성·재사용과 dispatch ID 영속은 필수**지만 `JS_RUNNING` polling, `STT_READY` 수신·영속,
LIVE 직전 STT 재검증만 건너뛴다. 이때 자막 없이 LIVE가 될 수 있는 위험을 허용한다. Dispatch 생성
실패는 `STT_DISPATCH_FAILED`로 시작을 막는다. Phase 4b가 배포되기 전에 설정을 false로 바꾸면
`STT_READINESS_GATE_UNAVAILABLE`로 fail-closed하며 readiness를 조용히 우회하지 않는다. 목표 v2가
양쪽에 배포되고 계약 테스트가 통과한 뒤 기본값을 false로 바꾼다.

정상 종료 제어면은 별도 Python HTTP/Redis stop 명령이 아니라 **Spring의 LiveKit room 삭제**다. agent는 `ROOM_DELETED`만 정상 EOF로 보고 drain 후 §3-4 completion을 발행한다. 상세: [`dispatch schema`](../ai/realtime-agent/contracts/schemas/dispatch-metadata.schema.json)·[`fixture`](../ai/realtime-agent/contracts/fixtures/dispatch-metadata.valid.json).

### 3-4. realtime-agent → application Redis 자막 Stream — AI 구현됨, Spring consumer 구현(ADR-0043)
Redis는 LiveKit 내부 Redis가 아닌 application Redis다. key는 `CAPTION_STREAM_KEY`로 주입하며 기본값은 전역 `ai:captions:live`. 모든 `XADD`에 `MAXLEN ~ CAPTION_STREAM_MAXLEN`(기본 10,000)을 적용한다. entry value는 모두 문자열이고 정수 필드는 부호 없는 최대 18자리 십진 문자열이다.

| `type` | 필수 필드 |
|---|---|
| `caption.delta` | `contractVersion="1"`, `eventId`, `sessionId`, `lessonId`, `sttSessionId`, `sequence`, `streamElapsedMs`, `text`, `occurredAt` |
| `caption.stream.completed` | `contractVersion="1"`, `eventId`, `sessionId`, `lessonId`, `sttSessionId`, `lastSequence`, `streamElapsedMs`, `reason="ROOM_DELETED"`, `occurredAt` |

`sequence`·`lastSequence`는 `(sessionId, sttSessionId)` 한 job attempt 안에서만 증가한다. retry는 새 `sttSessionId`에서 `sequence=1`로 시작할 수 있으므로 Spring은 attempt 단위로 접고 at-least-once write는 `eventId`로 중복 제거한다. `streamElapsedMs`는 **agent가 첫 audio frame을 받은 시점을 0으로 한 attempt-local 시간**이지 Spring session clock이 아니다.

현재 agent는 `caption.segment.final`·`caption.partial|final|revised`를 발행하지 않는다. Spring consumer는 ai-api(`ai-rag-live-v1`)와 **별도 group `spring-caption-live-v1`**로 소비하고(ADR-0043), `eventId` 멱등으로 `caption.delta`·`caption.stream.completed`를 **append-only로 core.live_caption에 영속**한 뒤 저장분만 `/topic/live-sessions/{sessionId}/captions` WS로 전달한다(§3-6). raw `streamElapsedMs`를 **그대로 저장·중계**하며 세션 상대 ms로 변환하지 않는다 — session/HLS time-origin 변환·앵커, owner fencing, 전역 key의 session별 분리·정리는 후속 공유 계약이다(전역 key는 producer의 `MAXLEN ~`에 정리를 위임하고 consumer는 키를 DEL하지 않는다). consumer가 소비하는 Redis는 `spring.data.redis`가 가리키는 **프로필 구동 Redis**다(remote 프로필=EC2 :4000 application Redis). **prod 캡션-Redis 토폴로지(현재 prod redis ≠ 캡션 redis)는 AI/인프라 오너의 별도 작업**이며 이 구현이 해결하지 않는다(ADR-0043 §의존성). 상세: [`caption schema`](../ai/realtime-agent/contracts/schemas/caption-stream-entry.schema.json)·[`delta fixture`](../ai/realtime-agent/contracts/fixtures/caption-delta.valid.json)·[`completion fixture`](../ai/realtime-agent/contracts/fixtures/caption-completed.valid.json)·[ADR-0043](decisions/songjeongki/0043-caption-consumer-persistence.md).

### 3-5. realtime-agent → Spring lifecycle callback (HTTP, 서명) — v1 AI 구현/기본 off, v2 양쪽 미구현
Spring 수신 endpoint를 구현하고 `SPRING_STATUS_CALLBACK_URL`로 주입하기 전까지 `SPRING_STATUS_CALLBACK_ENABLED=false`로 둔다. 기존 material callback(§3-2)과 body·header·서명이 호환되지 않으므로 `POST /api/internal/ai/callbacks`로 보내지 않으며 실제 URL은 Java 구현에서 확정한다.

- body: `{ contractVersion:"1", eventId, eventType:"LIVE_AGENT_STATUS", sessionId, lessonId, jobId, state, occurredAt, error? }`.
- `state`: `ROOM_CONNECTED|STT_STARTED|AUDIO_STARTED|STOPPING|SUCCEEDED|FAILED`. `FAILED`만 `error { code, message, retryable }` 필수.
- headers: `Idempotency-Key:{eventId}`, `X-Correlation-Id:{dispatch correlationId}`, `X-LiveClass-Timestamp:{Unix seconds}`, `X-LiveClass-Signature:v1={lowercase hex HMAC-SHA256}`.
- 서명 입력: `ASCII(timestamp) + "." + rawBody`; secret은 최소 32 UTF-8 byte.

한 v1 event의 bounded retry는 event ID·timestamp·raw body·signature를 그대로 재사용한다. Spring은 `Idempotency-Key`를 멱등 처리하고 terminal을 first-wins로 접는다. **v1 nonterminal** callback은 best-effort이며 소실될 수 있다. 상세: [`status schema`](../ai/realtime-agent/contracts/schemas/live-agent-status.schema.json)·[`signing vector`](../ai/realtime-agent/contracts/fixtures/live-agent-status-signing.valid.json).

라이브 시작 gate에는 위 v1 신호만으로 부족하므로 다음 **목표 v2**를 사용한다.

- body는 v1 필드에 `sttSessionId`를 추가하고 `contractVersion:"2"`,
  `state:"STT_READY"`로 보낸다. `sttSessionId`는 safe identifier이며 같은 job 안에서 고정한다.
- `STT_READY`는 배정된 같은 job이 session lease 획득·renewal, provider model load와 실제 warm
  inference 또는 remote session open, application Redis read/write, 유일한 강사 microphone subscribe,
  첫 frame의 engine queue 수용과 내부 task 생존을 모두 확인했다는 서명된 assertion이다.
- `STT_READY`는 nonterminal이지만 best-effort가 아니다. agent는 같은 event ID·timestamp·raw
  body·signature로 bounded retry하고, Spring은 HMAC·correlation·session·lesson·job을 검증해
  inbox와 agent job을 영속한 뒤에만 2xx를 반환한다.
- readiness callback 또는 영속 ACK가 timeout이면 agent job과 start attempt는 실패한다.
- terminal 또는 비활성 start attempt에 늦게 도착한 `STT_READY`는 inbox에만 멱등 기록하고
  상태를 되살리지 않으며 2xx로 재시도를 끝낸다.
- `ROOM_CONNECTED`, `STT_STARTED`, `AUDIO_STARTED`는 계속 best-effort 진단 신호이며
  `STT_READY`를 대신하지 않는다.

현재 연결된 schema와 fixture, Python serializer는 v1이라 `STT_READY`를 허용하지 않는다. v2를
활성화하기 전에 별도 v2 schema·fixture와 Java/Python 계약 테스트를 같은 common 변경에서 추가한다.

### 3-6. FE ↔ Spring WebSocket
- **자막 채널** `/topic/live-sessions/{sessionId}/captions`(세션별, 구독 인가는 채팅과 동일 게이트·와일드카드 차단 불변식 ADR-0019·0043): `WsEnvelope.of(type, sessionId, occurredAt, payload)`로 push. `type`은 `caption.delta`·`caption.stream.completed`. payload는 camelCase — delta `{ sttSessionId, sequence, streamElapsedMs, sessionMs, text }`, completed `{ sttSessionId, lastSequence, sessionMs, reason }`.
- **채팅 채널** `/topic/live-sessions/{sessionId}/chat`: `chat_message { lessonId, sessionMs, text, alias }`(실명·userId 미노출).
- 채팅 시간은 **세션 상대 ms**(`sessionMs`)다. **자막의 `streamElapsedMs`는 §3-4의 raw attempt-local ms를 그대로 노출**한다(변환 금지) — 세션 상대 ms 변환·앵커는 후속 공유 계약이며 그 전까지 FE는 raw 값으로 취급한다(ADR-0043). **추가로 자막 payload에 근사 `sessionMs`(Long, nullable)를 함께 싣는다**: `max(0, occurredAt − session.clockOriginAt)`로 서버가 읽기 시 계산하는 **근사 세션-ms**로, 학생이 HLS 영상 위치에 자막을 맞추는 **표시용**이다([ADR-0045](decisions/songjeongki/0045-live-caption-position-sync-approx-session-ms.md)). 이는 `streamElapsedMs` 변환이 아니라 occurredAt 기반의 별도 근사 축이며(streamElapsedMs는 raw 그대로 유지), §3-4의 "streamElapsedMs→세션ms 변환 금지"에 대한 **의도적 편차**다 — 오차 ~1~2s(STT 지연+시계 스큐)는 HLS 지연(수초~수십초)보다 작다. clockOriginAt이 없으면 null. 앵커 기반 정밀화는 후속.

### 3-7. EC2 ai-worker → GPU bge-runtime (HTTP) — AI 구현됨

이 호출은 **Spring이 보내는 API가 아니다**. Spring은 §3-1의 자료 잡을 RabbitMQ에 발행하고 §3-2의 최종
callback만 받는다. EC2 `ai-worker`가 PPTX를 내려받아 chunking한 뒤 GPU에 embedding만 요청하고, 반환된
vector를 `ai` schema의 pgvector에 저장한다. GPU `bge-runtime`에는 RabbitMQ·PostgreSQL·Spring credential을
주입하지 않는다.

운영에서 ai-worker의 호출 origin은
`AI_WORKER_BGE_RUNTIME_URL=http://127.0.0.1:18020`이다. 이 EC2 loopback listener는 GPU 서버가 유지하는
reverse SSH tunnel `127.0.0.1:18020 -> GPU 127.0.0.1:8020`으로만 연결한다. 두 포트를 public ingress로
열지 않는다. EC2에서 `GET http://127.0.0.1:18020/readyz`가 200이어야 호출 가능하다.

```http
POST http://127.0.0.1:18020/internal/v1/embeddings
Authorization: Bearer <AI_WORKER_BGE_INTERNAL_TOKEN>
Content-Type: application/json

{
  "model": "BAAI/bge-m3",
  "revision": "5617a9f61b028005a4858fdac845db406aefb181",
  "texts": ["첫 번째 chunk", "두 번째 chunk"]
}
```

```text
200 OK
{
  "model": "BAAI/bge-m3",
  "revision": "5617a9f61b028005a4858fdac845db406aefb181",
  "dimensions": 1024,
  "normalized": true,
  "embeddings": [[finite float × 1024], [finite float × 1024]]
}
```

- EC2의 `AI_WORKER_BGE_INTERNAL_TOKEN`과 GPU의 `BGE_RUNTIME_INTERNAL_TOKEN`은 같은 32자 이상 secret이다.
  Spring callback HMAC secret과 공유하지 않으며 token 값을 요청 body·로그·예외에 노출하지 않는다.
- `texts`는 요청당 1~4개이고 각 문자열은 공백이 아니며 최대 4,000자다. ai-worker는 전체 chunk를 최대
  4개씩 나눠 순차 호출하며 요청 순서를 보존한다.
- 성공은 200이고 body는
  `{ model, revision, dimensions:1024, normalized:true, embeddings }`다. `embeddings`는 `texts`와
  같은 개수·순서다. 각 vector는 모든 원소가 finite인 실수 1,024개이고 전체가 영벡터가 아니어야 한다.
  model·revision이 요청과 다르면 성공으로 처리하지 않는다.
- network 오류·429·5xx만 retryable이다(429 응답은 `Retry-After: 1`). 400·409·413·422는 요청/계약
  위반이고, 401은 인증·설정 오류다. 그 밖의 4xx도 현재는 재시도하지 않는다. HTTP adapter는 자체 재시도하지
  않고 자료 consumer의 제한된 재시도(기본 3회)와 DLQ에 맡긴다.

상세 topology와 운영 근거는
[ADR-0029](decisions/canola/0029-gpu-bge-ec2-ai-worker-connectivity.md), ai-worker 쪽 검증 규칙은
[`ai/ai-worker/CONTRACT.md` §9.4](../ai/ai-worker/CONTRACT.md#94-remote-bge-runtime)를 따른다.

### 3-8. GPU realtime-agent service health (HTTP) — AI 구현됨, Spring consumer 미구현

GPU agent는 `127.0.0.1:8081`, EC2 reverse tunnel은 `127.0.0.1:18081`에만 bind한다. EC2 host에서는
reverse tunnel 주소로 상태를 확인할 수 있지만 Spring consumer와 backend container의 접근 경로는
아직 구현하지 않았다. 18081은 public bind하지 않는다.

- `GET /health/live`: **200**
  `{"contractVersion":"1","status":"alive","service":"realtime-agent"}`.
- `GET /health/ready`: AgentServer 시작, 현재 LiveKit worker 연결, 설정된 child process 전부의 STT
  provider prewarm이 완료되면 **200**과 `status:"ready"`, 아니면 **503**과 `status:"notReady"`.
  공통 body는 `{contractVersion,status,service,sttProvider,workerStarted,liveKitConnected,modelsReady,readyProcessCount,expectedProcessCount}`다.

Nemotron의 process marker는 `prewarm()`의 model load가 성공한 뒤에만 생긴다. 종료된/reuse된 PID의
marker는 준비 수에 포함하지 않는다. 이 service-level readiness는 배포 및 향후 consumer 사전 진단용이다.
실제 dispatch를 예약하지 않고 특정 job의 session lease·Redis·room audio·engine queue를 검사하지
않으므로 §3-3의 job-level `STT_READY` gate를 대체하지 않는다. 정본 schema와 AI fixture는
[`realtime-agent-health.schema.json`](../ai/realtime-agent/contracts/schemas/realtime-agent-health.schema.json)에 둔다.

### 3-9. Spring → ai-api RAG SSE (HTTP, HMAC 서명) — 양쪽 구현됨

```http
POST /internal/v1/rag/answers:stream
Accept: text/event-stream
Content-Type: application/json
X-Internal-Signature: base64(HMAC-SHA256(AI_INTERNAL_SECRET, rawBody))

{"requestId":"...","lessonId":"...","sessionId":"...","question":"...","contextTimeMs":0,"issuedAtMs":1785120000000}
```

인증은 [ADR-0023 §9](decisions/canola/0023-spring-to-ai-rag-jwt-contract.md)의 **HMAC 공유 시크릿**이다(RS256 JWT는 phase-2 로드맵). 시크릿은 `AI_INTERNAL_SECRET`으로 **콜백용 `AI_CALLBACK_SECRET`과 다른 값**이다([ai/CONTRACT.md §3.2](ai/CONTRACT.md)). Spring 구현은 [ADR-0047](decisions/songjeongki/0047-live-ai-answer-sse-proxy.md), ai-api 상세 검증 규칙은 [`ai/ai-api/CONTRACT.md`](../ai/ai-api/CONTRACT.md)가 소유한다.

- **서명 대상은 요청 원시 body 전체**다. Spring은 body를 **한 번만** 직렬화해 그 바이트로 서명하고 **같은 바이트를 전송**한다 — 재직렬화하면 서명이 깨져 401이다.
- body는 **정확히 위 6필드**다(ai-api가 `extra="forbid"`라 하나만 늘어도 400). `requestId` 1~128자·재사용 시 409, `lessonId`·`sessionId`는 **소문자 canonical UUID**, `question` 1~4,000자·**임의 trim 금지**, `contextTimeMs`는 0 이상의 **최신 STT attempt-local `streamElapsedMs` 좌표**(세션-ms 아님), `issuedAtMs`는 UTC epoch ms로 수신 시각과 60초 이상 차이나거나 5초 초과 미래면 401.
- **`contextTimeMs`는 `core.live_caption`의 해당 세션 최신 행 raw `stream_elapsed_ms`로 채운다**(자막이 없으면 0). §3-4가 금지한 `streamElapsedMs→세션ms` 변환을 하지 않으므로 앵커 없이 규격을 만족한다. §3-6의 근사 `sessionMs`(표시용, ADR-0045)는 여기 쓰지 않는다.
- SSE 이벤트는 `answer.delta` 0개 이상 + `answer.done|answer.insufficient|answer.error` 정확히 하나다. `answer.done.sources` 항목은 `{"type":"PPTX","materialId":uuid,"page":int}` 또는 `{"type":"CAPTION","sessionId":uuid,"sttSessionId":str,"startMs":int,"endMs":int}`이며 최초 evidence 순서를 보존·중복 제거한다.
- ai-api 상태코드: 200·400(body 위반)·401(인증 거부)·406(Accept 없음)·409(requestId 재사용)·503(RAG service 미배선 또는 process-local active 한도 초과). SSE 헤더가 시작된 뒤의 실패는 상태를 바꾸지 않고 `answer.error`다.
- Spring은 브라우저에 이 이벤트를 **변환 없이 그대로 릴레이**하고(§2 AI), 클라 취소 시 업스트림 연결을 닫아 ai-api의 active 슬롯을 반납한다.

## 4. 스키마 소유권 (공동수정 금지)
- `core` = Spring 단독 쓰기, `ai` = Python 단독 쓰기. AI 후보(ai)→강사 게시→core read model. 상세: [ARCHITECTURE.md](ARCHITECTURE.md) 도메인 모델.

## 5. 기능 ↔ 오너 맵 (CP 기준)
| CP | 영역 | 오너 | 계약 |
|---|---|---|---|
| CP0 | 인증·강좌·live_session | _미정_ | §2 |
| CP1 | 라이브 미디어(LiveKit·채팅) | _미정_ | §2 라이브, §3-6 |
| CP2 | 라이브 자막(STT) | _미정_ | §3-3~§3-6, §3-8 |
| CP3 | 용어·RAG | _미정_ | §2 AI, §3-1, §3-2, §3-7 |
| CP4 | 녹화·다시보기(Egress) | _미정_ | §2 다시보기, §3-1 |
| CP5 | 퀴즈·따라잡기 | _미정_ | §2 |

## 6. 계약 변경 절차
1. 변경 전 오너 합의 → 확정은 [decisions/](decisions/)에 ADR.
2. 걸린 양쪽(FE·BE 또는 Spring·AI)을 함께 수정.
3. 이 문서·관련 계약 테스트 갱신. MR 체크리스트 계약 항목 체크.
