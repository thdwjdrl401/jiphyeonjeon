# CONTRACT.md — 공유 계약 (정본)

> 📍 하네스 개요: [docs/harness/README.md](harness/README.md) · 정본 규칙: [AGENTS.md](../AGENTS.md) · 아키텍처: [ARCHITECTURE.md](ARCHITECTURE.md)
>
> **FE↔Spring**, **Spring↔AI(RabbitMQ/HTTP/LiveKit AgentDispatch/Redis Streams)** 이 동시에 지켜야 어긋나지 않는 계약. 한쪽이 바꾸면 다른 쪽이 깨지는 항목만.
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
| 자료 | `POST /instructor/lessons/{id}/materials` (PPTX) | presigned→MinIO. **영상 업로드 없음**. 본문은 `{"assetId":"..."}`(먼저 에셋으로 올린 PPTX를 연결, multipart 아님). 소유 강사만(비소유 403·없는 레슨 404), 성공 **201** `{materialId, assetId, fileName, status}`. 같은 (레슨,에셋) 중복 연결 **409** `MATERIAL_ALREADY_ATTACHED`(DB 부분 유니크 인덱스로 동시요청도 차단), 잘못된 에셋(없음·kind 불일치·미완료·업로더 불일치) **400** `MATERIAL_INVALID`. 레슨 상세(`GET /lessons/{id}`)·커리큘럼 상세·**강사 관리용 `GET /instructor/lessons/{id}`**의 `materials`는 연결된 활성 자료로 채워지되, **커리큘럼 상세는 ENROLLED·OWNER_INSTRUCTOR에게만 노출**(게스트·미수강자는 빈 목록). **삭제** `DELETE .../materials/{materialId}`(소프트, 멱등)·**다운로드** `GET .../materials/{materialId}/download`(presigned 302). 자료 응답에 **`embeddingStatus`**(PENDING/PROCESSING/READY/FAILED, [0036](decisions/songjeongki/0036-material-embedding-pipeline.md)) — 임베딩 파이프라인(outbox→RabbitMQ→AI→pgvector→콜백)은 스위치(`material.embedding.enabled`) 뒤, 기본 off라 지금은 READY. **AI 콜백** `POST /api/internal/ai/callbacks`(§3-2, HMAC 서명·inbox 멱등)로 상태 확정 ([decisions/songjeongki/0035](decisions/songjeongki/0035-lesson-material-attach.md), [0036](decisions/songjeongki/0036-material-embedding-pipeline.md)) |
| 에셋 | `POST /assets/upload-requests` → presigned `PUT` → `POST /assets/{id}/complete` | 바이트는 앱 서버를 통과하지 않는다. 받은 `assetId`를 도메인 요청에 실어 보낸다(커리큘럼 `thumbnailAssetId`, 프로필 `assetId`, 레슨 자료 `assetId`). kind별 발급: **PROFILE_IMAGE는 인증된 누구나**, **THUMBNAIL·MATERIAL은 강사만**(학생 403). MATERIAL은 **PPTX만·50MiB**, 이미지 kind는 jpeg·png·webp·5MiB — 형식·크기 위반은 400 ([decisions/songjeongki/0023](decisions/songjeongki/0023-asset-presigned-upload.md), [0035](decisions/songjeongki/0035-lesson-material-attach.md)) |
| 다시보기 | `GET /lessons/{id}/playback` · `GET /lessons/{id}/playback/manifest` · `POST /instructor/lessons/{id}/replay-review/publish` · `POST /instructor/lessons/{id}/replay-review/withdraw` · `POST /webhooks/livekit` | **라이브 되감기·종료 후 재생 API 구현됨**([decisions/choinhoo/0001](decisions/choinhoo/0001-live-replay-playback-api.md), [decisions/songjeongki/0039](decisions/songjeongki/0039-replay-playback-api.md)). metadata 응답은 `{lessonId, videoAssetId, sessionId, startedAt, liveSessionStatus, currentSessionMs, sessionOffsetMs, durationMs, source}`이고 `source`는 `{url, availableFromMs, availableToMs}` 또는 manifest 생성 전이면 `null`이다. **source는 하나다** — 라이브 중 재생목록은 `#EXT-X-ENDLIST` 없이 자라는 EVENT 목록이라 라이브 엣지와 세션 처음까지의 seek을 한 목록이 동시에 준다. `url`은 인증된 manifest endpoint이며 `application/vnd.apple.mpegurl`·`Cache-Control: no-store`; 그 본문의 일반 세그먼트와 `EXT-X-MAP/KEY` URI를 presigned GET으로 재작성한다. **라이브 중에는 `#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL`(기본 60s, `video.playback.can-skip-until`)로 델타 재생목록을 광고하고, 플레이어가 `_HLS_skip=YES`로 다시 물으면 경계보다 오래된 세그먼트를 `#EXT-X-SKIP:SKIPPED-SEGMENTS=N`으로 생략한다**(RFC 8216bis §6.2.5.1). 생략은 삭제가 아니라 병합 지시라 `EXT-X-MEDIA-SEQUENCE`가 불변이고 플레이어 진행 바는 강의 전체를 유지한다. 종료 후 재생목록은 ENDLIST가 있어 플레이어가 다시 받지 않으므로 델타를 쓰지 않는다. 학생은 활성 수강 + 레슨 PUBLISHED가 필수이고, 세션 `STARTING/LIVE/ENDING` 중에는 `replayStatus`와 무관하게 시청하며, 종료 후에는 자산 READY + replay PUBLISHED만 시청한다. 소유 강사는 게시 전에도 미리보기한다. 첫 PDT − 세션 시작시각을 `sessionOffsetMs`로 요청마다 계산한다. 세그먼트 URL TTL은 `video.playback.segment-url-ttl`(기본 **6h**) — **델타는 옛 세그먼트 URL을 다시 주지 않으므로 강의 길이보다 짧으면 오래 시청한 학생의 되감기가 403이 된다**. 세그먼트는 공개 도메인(`video.playback.public-endpoint`)으로 서명해 nginx `/recordings/`로 서빙하며, backend가 매니페스트를 읽는 내부 주소(`livekit.egress.s3-endpoint`)와 다르다(SigV4가 Host를 서명에 포함). manifest 생성 지연 409 `RECORDING_STARTING`, 종료 자산 미준비·manifest 유실 409 `REPLAY_NOT_READY`, 스토리지 장애 503 `PLAYBACK_STORAGE_UNAVAILABLE`; 세그먼트 403/장시간 일시정지 뒤에는 같은 URL을 다시 로드한다. 게시·철회는 소유 강사만, 둘 다 204 멱등이며 게시에는 READY가 필요하고 라이브 중 철회는 409 `REPLAY_WITHDRAW_WHILE_LIVE`다. 검수 데이터 저장(`PUT .../replay-review`)은 CP2·CP3 산출물이 없어 미구현. LiveKit webhook은 JWT 검증 후 자산 READY/FAILED와 녹화 통계를 멱등 확정한다([0034](decisions/songjeongki/0034-egress-completion-webhook.md)). |
| 학습 | `GET /lessons/{id}/learning-context`·`PUT /lessons/{id}/progress`·`POST .../bookmarks` | **구현됨**(learning 배선, [decisions/songjeongki/0033](decisions/songjeongki/0033-learning-progress-wiring.md)). 수강자만(미수강 403 `ENROLLMENT_REQUIRED`, 없는 레슨 404). 진도율은 **클라이언트 계산·서버 저장**(0~100), 90% 넘으면 완료(sticky), `clientUpdatedAt`으로 순서역전 방어. 북마크는 멱등. **카탈로그 `progress`는 이제 활성 수강자에게 채워진다**(완료 레슨 수 기준, 상세·내 수강 목록). watched_ranges 정교화는 후속 |
| 내 수강·대시보드 | `GET /me/enrollments`·`GET /me/learning-summary`·`GET /instructor/dashboard-summary` | **항목마다 커리큘럼 카드 동봉(구현됨)** — 목록을 받고 커리큘럼을 건건이 다시 조회하지 않도록. **학습 요약(구현됨)**: 활성 수강 전반의 `inProgressCurriculumCount`·`completedCurriculumCount`·`averageProgress`(0~100)·`completedLessonCount`와 `todayLiveSession`(가장 이른 예정/진행 라이브, 없으면 null). 로그인 필요, 비학생·수강 없음은 0 요약. **강사 대시보드 요약(구현됨)**: `GET /instructor/dashboard-summary` — `totalCurriculumCount`·`publishedCurriculumCount`·`upcomingLiveCount`·`totalEnrolleeCount`와 `todayLiveSession`([decisions/songjeongki/0041](decisions/songjeongki/0041-instructor-authoring-reads-and-autosave.md)). 소유 모듈은 curriculum |
| 자막/용어 | `GET /lessons/{id}/transcript`·`/glossary` | 게시본(core) |
| AI | `POST /lessons/{id}/ai/questions:stream`(SSE)·`/ai/terms:explain` | Spring이 권한·정책 후 ai-api 중계 |
| 퀴즈 | `GET /lessons/{id}/quizzes`·`POST /quizzes/{id}/attempts` | 결정론 채점 |
| 채팅 | `GET/POST /live-sessions/{sessionId}/messages` | **세션 키잉(구현됨)**, 본문도 세션 기준. 가명, WS 실시간 + REST 보완 |
| 라이브 | `POST /live-sessions/{id}/start`·`/token`·`/end` | 시작(토큰+Egress 녹화 시작)·LiveKit 토큰(publish/subscribe)·종료 |

## 3. 내부 계약 (확정 인터페이스)

### 3-1. Spring → AI 배치 잡 (RabbitMQ)
자료 임베딩 잡 envelope(정본은 코드 `InstructorCurriculumService.enqueueEmbedJob`): `{ taskType, materialId, assetId, lessonId, curriculumId, fileName, policy{embedModel}, contractVersion }`. taskType: `PPTX_EMBED`(자료 임베딩)·`EMBED_DELETE`(자료 삭제 시 chunk 제거) 등. (라이브 STT는 배치 아님 — Redis Streams §3-4. 트랜스코드는 없음 — VOD=Egress 녹화, [decisions/songjeongki/0010](decisions/songjeongki/0010-self-host-vod.md)) **outbox**로 발행 신뢰성, 실패는 **DLQ**. **워커 파일 접근(B안, 주문형 발급)**: envelope에 파일 위치·URL을 싣지 않는다. 워커가 잡 처리 **직전에** `POST /api/internal/ai/materials/download-url`(본문 `{assetId}`, §3-2와 동일 HMAC 서명)로 갓 서명된 presigned GET URL을 받아 스토리지에서 직접 읽는다 — 자격증명을 워커에 두지 않고, 사용 직전 발급이라 TTL 만료와 무관. chunk 정책(chunkSize·overlap)은 워커 설정 소유(envelope의 `policy`는 `embedModel`만). 상세: [decisions/songjeongki/0036](decisions/songjeongki/0036-material-embedding-pipeline.md).

### 3-2. AI → Spring callback (HTTP, 서명) — 구현됨
`POST /api/internal/ai/callbacks` — permitAll이되 **HMAC-SHA256 서명이 실질 인증**이다(egress webhook 0034와 동일 패턴). 워커가 공유 시크릿(`ai.callback-secret`)으로 **원시 바이트 body**를 서명해 `X-Signature`(base64) 헤더에 실어 보내고, 검증 실패는 401. body: `{ eventId, eventType, jobId, materialId, lessonId, status }`(미지의 필드는 무시). Spring은 `external_event_inbox`에 `(source=ai-worker, eventId)` 복합키로 삽입해 **멱등** 처리(중복이면 무시). eventType → 자료 임베딩 상태 매핑: `MATERIAL_EMBEDDED`→READY, `MATERIAL_EMBED_FAILED`→FAILED, `MATERIAL_EMBEDDING`→PROCESSING, 그 외는 inbox에만 남기고 상태 불변. 코드: `aiintegration/service/AiCallbackService.java`·`web/AiCallbackVerifier.java`. 상세: [decisions/songjeongki/0036](decisions/songjeongki/0036-material-embedding-pipeline.md).

### 3-3. Spring → realtime-agent (LiveKit explicit AgentDispatch) — AI 구현됨, Spring 미구현
Spring은 LiveKit room·권한·생명주기를 소유하고, realtime-agent는 Worker 등록과 배정된 STT job을 소유한다. Java의 `agentName`과 Python의 `STT_AGENT_NAME`은 정확히 같아야 하며 assigned/connected room은 모두 `session-{sessionId}`여야 한다. 근거: [ADR-0025](decisions/canola/0025-realtime-agent-spring-handoff-contract.md).

dispatch metadata는 최대 4,096 UTF-8 byte의 JSON object다. 아래 네 필드만 허용하며 알 수 없는/중복/누락 필드는 agent가 외부 자원을 열기 전에 거부한다.

| 필드 | 계약 |
|---|---|
| `contractVersion` | 문자열 `"1"` |
| `sessionId`, `lessonId` | 소문자 canonical UUID 문자열 |
| `correlationId` | `[A-Za-z0-9][A-Za-z0-9._:-]{0,127}` |

`instructorIdentity`는 넣지 않는다. Spring은 remote microphone publisher가 강사 한 명뿐이도록 room 권한을 보장하고, agent는 두 번째 publisher를 발견하면 fail-closed 처리한다. Spring은 dispatch/job ID를 저장하고 동일 start retry에서 기존 dispatch를 재사용하며, assignment/running 확인·assignment timeout·capacity failure·취소·정리를 멱등 처리한다. 가용 Worker가 없거나 모두 FULL이면 job은 pending이다.

정상 종료 제어면은 별도 Python HTTP/Redis stop 명령이 아니라 **Spring의 LiveKit room 삭제**다. agent는 `ROOM_DELETED`만 정상 EOF로 보고 drain 후 §3-4 completion을 발행한다. 상세: [`dispatch schema`](../ai/realtime-agent/contracts/schemas/dispatch-metadata.schema.json)·[`fixture`](../ai/realtime-agent/contracts/fixtures/dispatch-metadata.valid.json).

### 3-4. realtime-agent → application Redis 자막 Stream — AI 구현됨, Spring consumer 미구현
Redis는 LiveKit 내부 Redis가 아닌 application Redis다. key는 `CAPTION_STREAM_KEY`로 주입하며 기본값은 전역 `ai:captions:live`. 모든 `XADD`에 `MAXLEN ~ CAPTION_STREAM_MAXLEN`(기본 10,000)을 적용한다. entry value는 모두 문자열이고 정수 필드는 부호 없는 최대 18자리 십진 문자열이다.

| `type` | 필수 필드 |
|---|---|
| `caption.delta` | `contractVersion="1"`, `eventId`, `sessionId`, `lessonId`, `sttSessionId`, `sequence`, `streamElapsedMs`, `text`, `occurredAt` |
| `caption.stream.completed` | `contractVersion="1"`, `eventId`, `sessionId`, `lessonId`, `sttSessionId`, `lastSequence`, `streamElapsedMs`, `reason="ROOM_DELETED"`, `occurredAt` |

`sequence`·`lastSequence`는 `(sessionId, sttSessionId)` 한 job attempt 안에서만 증가한다. retry는 새 `sttSessionId`에서 `sequence=1`로 시작할 수 있으므로 Spring은 attempt 단위로 접고 at-least-once write는 `eventId`로 중복 제거한다. `streamElapsedMs`는 **agent가 첫 audio frame을 받은 시점을 0으로 한 attempt-local 시간**이지 Spring session clock이 아니다.

현재 agent는 `caption.segment.final`·`caption.partial|final|revised`를 발행하지 않는다. consumer group, 전역 key 정리, owner fencing, session/HLS time-origin 변환은 후속 공유 계약이며 변환 전 raw `streamElapsedMs`를 세션 상대 ms로 영속·중계하지 않는다. 상세: [`caption schema`](../ai/realtime-agent/contracts/schemas/caption-stream-entry.schema.json)·[`delta fixture`](../ai/realtime-agent/contracts/fixtures/caption-delta.valid.json)·[`completion fixture`](../ai/realtime-agent/contracts/fixtures/caption-completed.valid.json).

### 3-5. realtime-agent → Spring lifecycle callback (HTTP, 서명) — AI 구현됨/기본 off, Spring 미구현
Spring 수신 endpoint를 구현하고 `SPRING_STATUS_CALLBACK_URL`로 주입하기 전까지 `SPRING_STATUS_CALLBACK_ENABLED=false`로 둔다. 기존 material callback(§3-2)과 body·header·서명이 호환되지 않으므로 `POST /api/internal/ai/callbacks`로 보내지 않으며 실제 URL은 Java 구현에서 확정한다.

- body: `{ contractVersion:"1", eventId, eventType:"LIVE_AGENT_STATUS", sessionId, lessonId, jobId, state, occurredAt, error? }`.
- `state`: `ROOM_CONNECTED|STT_STARTED|AUDIO_STARTED|STOPPING|SUCCEEDED|FAILED`. `FAILED`만 `error { code, message, retryable }` 필수.
- headers: `Idempotency-Key:{eventId}`, `X-Correlation-Id:{dispatch correlationId}`, `X-LiveClass-Timestamp:{Unix seconds}`, `X-LiveClass-Signature:v1={lowercase hex HMAC-SHA256}`.
- 서명 입력: `ASCII(timestamp) + "." + rawBody`; secret은 최소 32 UTF-8 byte.

한 event의 bounded retry는 event ID·timestamp·raw body·signature를 그대로 재사용한다. Spring은 `Idempotency-Key`를 멱등 처리하고 terminal을 first-wins로 접는다. nonterminal callback은 best-effort이며 소실될 수 있다. 상세: [`status schema`](../ai/realtime-agent/contracts/schemas/live-agent-status.schema.json)·[`signing vector`](../ai/realtime-agent/contracts/fixtures/live-agent-status-signing.valid.json).

### 3-6. FE ↔ Spring WebSocket
- **자막 채널**(세션/강의별): caption 이벤트 push.
- **채팅 채널**: `chat_message { lessonId, userId, sessionMs, text, alias }`.
- FE로 보내는 시간은 **세션 상대 ms**. §3-4의 `streamElapsedMs`를 그대로 노출하지 않는다.

## 4. 스키마 소유권 (공동수정 금지)
- `core` = Spring 단독 쓰기, `ai` = Python 단독 쓰기. AI 후보(ai)→강사 게시→core read model. 상세: [ARCHITECTURE.md](ARCHITECTURE.md) 도메인 모델.

## 5. 기능 ↔ 오너 맵 (CP 기준)
| CP | 영역 | 오너 | 계약 |
|---|---|---|---|
| CP0 | 인증·강좌·live_session | _미정_ | §2 |
| CP1 | 라이브 미디어(LiveKit·채팅) | _미정_ | §2 라이브, §3-6 |
| CP2 | 라이브 자막(STT) | _미정_ | §3-3~§3-6 |
| CP3 | 용어·RAG | _미정_ | §2 AI, §3-1, §3-2 |
| CP4 | 녹화·다시보기(Egress) | _미정_ | §2 다시보기, §3-1 |
| CP5 | 퀴즈·따라잡기 | _미정_ | §2 |

## 6. 계약 변경 절차
1. 변경 전 오너 합의 → 확정은 [decisions/](decisions/)에 ADR.
2. 걸린 양쪽(FE·BE 또는 Spring·AI)을 함께 수정.
3. 이 문서·관련 계약 테스트 갱신. MR 체크리스트 계약 항목 체크.
