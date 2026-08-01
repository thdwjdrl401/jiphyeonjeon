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
| 커리큘럼(강사) | `POST/PATCH/DELETE /instructor/curriculums`·`.../sections`·`.../curriculum/order` | 소유권 검증. **게시 선행 조건**: `POST /instructor/curriculums/{id}/publish`는 섹션 1개 이상 AND 커리큘럼 전체 강의 1개 이상일 때만 성공한다 — 미충족은 **409 `CURRICULUM_NOT_PUBLISHABLE`**이고 메시지가 무엇을 추가해야 하는지 알려 준다(섹션/강의/둘 다). 강의는 커리큘럼 전체 기준이라 빈 섹션이 남아 있어도 막지 않는다([decisions/seominkyeong/0006](decisions/seominkyeong/0006-curriculum-publish-preconditions.md)). **삭제는 초안만** — `DELETE /instructor/curriculums/{id}`는 `lifecycleStatus=DRAFT`일 때만 204이고, 공개·보관 상태는 409 `CURRICULUM_STATE_CONFLICT`로 거절한다(보관으로 유도). 섹션·레슨은 DB 캐스케이드로 함께 사라진다 ([decisions/seominkyeong/0001](decisions/seominkyeong/0001-draft-only-curriculum-delete.md)). **섹션 삭제는 비어 있을 때만** — 레슨이 남아 있으면 409 `SECTION_NOT_EMPTY` |
| 강의 | `POST /instructor/sections/{id}/lessons`·`PATCH /instructor/lessons/{id}`·`GET /lessons/{id}` | 상태 필드는 **어디서나 `status`**(목차·관리 응답 동일, `lessonStatus` 아님). 값은 **`PUBLISHED` 하나** — 레슨에는 초안이 없고 만들어지는 순간 게시 상태다. **레슨 발행·게시취소 엔드포인트는 없다**(`POST /instructor/lessons/{id}/publish`·`/unpublish` 제거). 외부 공개 여부는 **커리큘럼 `lifecycleStatus`만** 결정하며, 커리큘럼을 발행하면 그 안의 강의가 함께 공개된다([decisions/seominkyeong/0005](decisions/seominkyeong/0005-lesson-has-no-draft-state.md)). 수강생용 `GET /lessons/{id}`는 소유권이 아니라 **수강 관계**로 연다 — 미수강 403 `ENROLLMENT_REQUIRED`([decisions/songjeongki/0029](decisions/songjeongki/0029-lesson-detail-and-display-name.md)). 미게시 레슨이라는 개념이 없어져 수강자에게는 목차의 강의가 모두 열린다. **강사 저작 화면은 공개 카탈로그가 아니라 강사 엔드포인트로 읽는다** — `GET /instructor/lessons/{id}`는 상위 커리큘럼이 DRAFT여도 열리고 그 레슨의 **`liveSession`(sessionId·status·scheduledAt, 없으면 null)을 함께 준다**([decisions/songjeongki/0041](decisions/songjeongki/0041-instructor-authoring-reads-and-autosave.md)) |
| 자료 | `POST /instructor/lessons/{id}/materials` (PPTX) | presigned→MinIO. **영상 업로드 없음**. 본문은 `{"assetId":"..."}`(먼저 에셋으로 올린 PPTX를 연결, multipart 아님). 소유 강사만(비소유 403·없는 레슨 404), 성공 **201** `{materialId, assetId, fileName, status}`. 같은 (레슨,에셋) 중복 연결 **409** `MATERIAL_ALREADY_ATTACHED`(DB 부분 유니크 인덱스로 동시요청도 차단), 잘못된 에셋(없음·kind 불일치·미완료·업로더 불일치) **400** `MATERIAL_INVALID`. 레슨 상세(`GET /lessons/{id}`)·커리큘럼 상세·**강사 관리용 `GET /instructor/lessons/{id}`**의 `materials`는 연결된 활성 자료로 채워지되, **커리큘럼 상세는 ENROLLED·OWNER_INSTRUCTOR에게만 노출**(게스트·미수강자는 빈 목록). **삭제** `DELETE .../materials/{materialId}`(소프트, 멱등)·**다운로드** `GET .../materials/{materialId}/download`(presigned 302). 자료 응답에 **`embeddingStatus`**(PENDING/PROCESSING/READY/FAILED, [0036](decisions/songjeongki/0036-material-embedding-pipeline.md)) — 임베딩 파이프라인(outbox→RabbitMQ→AI→pgvector→콜백)은 스위치(`material.embedding.enabled`) 뒤, 기본 off라 지금은 READY. **AI 콜백** `POST /api/internal/ai/callbacks`(§3-2, HMAC 서명·inbox 멱등)로 상태 확정 ([decisions/songjeongki/0035](decisions/songjeongki/0035-lesson-material-attach.md), [0036](decisions/songjeongki/0036-material-embedding-pipeline.md)). **커리큘럼-레벨 자료(ADR-0042)**: 같은 계약을 스코프만 달리해 `POST/DELETE /instructor/curriculums/{id}/materials[/{materialId}]`·`GET .../download`으로 제공(레슨 자료와 대칭 — 201·409·400·204·302 동일, 같은 `material_asset` 테이블). 커리큘럼 공통 자료는 **강사 관리용 `GET /instructor/curriculums/{id}`의 `materials`**와 공개 상세(`GET /curriculums/{id}`, ENROLLED·OWNER_INSTRUCTOR 게이트)에 함께 노출된다 ([decisions/songjeongki/0042](decisions/songjeongki/0042-curriculum-material-attach-and-embedding-scope.md)) |
| 에셋 | `POST /assets/upload-requests` → presigned `PUT` → `POST /assets/{id}/complete` | 바이트는 앱 서버를 통과하지 않는다. 받은 `assetId`를 도메인 요청에 실어 보낸다(커리큘럼 `thumbnailAssetId`, 프로필 `assetId`, 레슨 자료 `assetId`). kind별 발급: **PROFILE_IMAGE는 인증된 누구나**, **THUMBNAIL·MATERIAL은 강사만**(학생 403). MATERIAL은 **PPTX만·50MiB**, 이미지 kind는 jpeg·png·webp·5MiB — 형식·크기 위반은 400 ([decisions/songjeongki/0023](decisions/songjeongki/0023-asset-presigned-upload.md), [0035](decisions/songjeongki/0035-lesson-material-attach.md)) |
| 다시보기 | `GET /lessons/{id}/playback` · `GET /lessons/{id}/playback/manifest` · `POST /instructor/lessons/{id}/replay-review/publish` · `POST /instructor/lessons/{id}/replay-review/withdraw` · `POST /webhooks/livekit` | **라이브 되감기·종료 후 재생 API 구현됨**([decisions/choinhoo/0001](decisions/choinhoo/0001-live-replay-playback-api.md), [decisions/songjeongki/0039](decisions/songjeongki/0039-replay-playback-api.md)). metadata 응답은 `{lessonId, videoAssetId, sessionId, startedAt, liveSessionStatus, currentSessionMs, sessionOffsetMs, durationMs, source}`이고 `source`는 `{url, availableFromMs, availableToMs}` 또는 manifest 생성 전이면 `null`이다. **STARTING은 준비 상태 조회만 허용하고, manifest가 이미 있어도 `source=null`이며 manifest endpoint는 409 `RECORDING_STARTING`이다. 실제 HLS source는 원자적 LIVE 전환 뒤에만 공개한다.** source는 하나다 — 라이브 중 재생목록은 `#EXT-X-ENDLIST` 없이 자라는 EVENT 목록이라 라이브 엣지와 세션 처음까지의 seek을 한 목록이 동시에 준다. `url`은 인증된 manifest endpoint이며 `application/vnd.apple.mpegurl`·`Cache-Control: no-store`; 그 본문의 일반 세그먼트와 `EXT-X-MAP/KEY` URI를 presigned GET으로 재작성한다. **라이브 중에는 `#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL`(기본 60s, `video.playback.can-skip-until`)로 델타 재생목록을 광고하고, 플레이어가 `_HLS_skip=YES`로 다시 물으면 경계보다 오래된 세그먼트를 `#EXT-X-SKIP:SKIPPED-SEGMENTS=N`으로 생략한다**(RFC 8216bis §6.2.5.1). 생략은 삭제가 아니라 병합 지시라 `EXT-X-MEDIA-SEQUENCE`가 불변이고 플레이어 진행 바는 강의 전체를 유지한다. 종료 후 재생목록은 ENDLIST가 있어 플레이어가 다시 받지 않으므로 델타를 쓰지 않는다. 학생은 활성 수강 + 레슨 PUBLISHED가 필수이고, 세션 `STARTING/LIVE/ENDING` 중에는 `replayStatus`와 무관하게 metadata를 조회하며 실제 재생은 LIVE/ENDING부터 한다. 종료 후에는 자산 READY + replay PUBLISHED만 시청한다. 소유 강사는 게시 전에도 미리보기한다. 첫 PDT − 세션 시작시각을 `sessionOffsetMs`로 요청마다 계산한다. 세그먼트 URL TTL은 `video.playback.segment-url-ttl`(기본 **6h**) — **델타는 옛 세그먼트 URL을 다시 주지 않으므로 강의 길이보다 짧으면 오래 시청한 학생의 되감기가 403이 된다**. 세그먼트는 공개 도메인(`video.playback.public-endpoint`)으로 서명해 nginx `/recordings/`로 서빙하며, backend가 매니페스트를 읽는 내부 주소(`livekit.egress.s3-endpoint`)와 다르다(SigV4가 Host를 서명에 포함). manifest 생성 지연 409 `RECORDING_STARTING`, 종료 자산 미준비·manifest 유실 409 `REPLAY_NOT_READY`, 스토리지 장애 503 `PLAYBACK_STORAGE_UNAVAILABLE`; 세그먼트 403/장시간 일시정지 뒤에는 같은 URL을 다시 로드한다. 게시·철회는 소유 강사만, 둘 다 204 멱등이며 게시에는 READY가 필요하고 라이브 중 철회는 409 `REPLAY_WITHDRAW_WHILE_LIVE`다. 검수 데이터 저장(`PUT .../replay-review`)은 CP2·CP3 산출물이 없어 미구현. LiveKit webhook은 JWT 검증 후 자산 READY/FAILED와 녹화 통계를 멱등 확정한다([0034](decisions/songjeongki/0034-egress-completion-webhook.md)). |
| 학습 | `GET /lessons/{id}/learning-context`·`PUT /lessons/{id}/progress`·`POST .../bookmarks` | **구현됨**(learning 배선, [decisions/songjeongki/0033](decisions/songjeongki/0033-learning-progress-wiring.md)). 수강자만(미수강 403 `ENROLLMENT_REQUIRED`, 없는 레슨 404). 진도율은 **클라이언트 계산·서버 저장**(0~100), 90% 넘으면 완료(sticky), `clientUpdatedAt`으로 순서역전 방어. 북마크는 멱등. **카탈로그 `progress`는 이제 활성 수강자에게 채워진다**(완료 레슨 수 기준, 상세·내 수강 목록). watched_ranges 정교화는 후속 |
| 내 수강·대시보드 | `GET /me/enrollments`·`GET /me/learning-summary`·`GET /instructor/dashboard-summary` | **항목마다 커리큘럼 카드 동봉(구현됨)** — 목록을 받고 커리큘럼을 건건이 다시 조회하지 않도록. **학습 요약(구현됨)**: 활성 수강 전반의 `inProgressCurriculumCount`·`completedCurriculumCount`·`averageProgress`(0~100)·`completedLessonCount`와 `todayLiveSession`(가장 이른 예정/진행 라이브, 없으면 null). 로그인 필요, 비학생·수강 없음은 0 요약. **강사 대시보드 요약(구현됨)**: `GET /instructor/dashboard-summary` — `totalCurriculumCount`·`publishedCurriculumCount`·`upcomingLiveCount`·`totalEnrolleeCount`와 `todayLiveSession`([decisions/songjeongki/0041](decisions/songjeongki/0041-instructor-authoring-reads-and-autosave.md)). 소유 모듈은 curriculum |
| 자막/용어 | `GET /lessons/{id}/transcript`·`/glossary` · **`GET /live-sessions/{sessionId}/captions`** | transcript·glossary는 게시본(core). **라이브 자막 리로드(구현됨, CAPTION-01/[ADR-0045](decisions/songjeongki/0045-live-caption-position-sync-approx-session-ms.md))**: 저장된 `core.live_caption`을 세션-ms 순으로 반환하며 각 항목은 WS 델타/종료 payload와 **같은 필드**(`type`·`sttSessionId`·`sequence`·`lastSequence`·`streamElapsedMs`·근사 `sessionMs`·`text`·`reason`·`occurredAt`)다. 인가는 세션 참가자(소유 강사/활성 수강생, 미참가 403). FE가 새로고침·재연결 뒤 WS 누적기에 그대로 시드해 자막을 복원한다. |
| AI | **`POST /live-sessions/{sessionId}/ai/answers/stream`(SSE, 구현됨)** · `/lessons/{id}/ai/terms:explain` | **라이브 AI 질의응답(AI-QUESTION-01, [ADR-0047](decisions/songjeongki/0047-live-ai-answer-sse-proxy.md))**: 요청 `{question}`(1~4,000자, 서버가 trim하지 않음)만 받고 `lessonId`·`contextTimeMs`·`requestId`는 **서버가 채운다**(클라 입력 신뢰 금지). 응답은 `text/event-stream`으로 **ai-api 이벤트를 변환 없이 그대로 릴레이**한다 — `answer.delta{requestId,text}` 0개 이상 + `answer.done{requestId,sources}`\|`answer.insufficient{requestId,message}`\|`answer.error{requestId,code,message,retryable}` **정확히 하나**(§3-9). 인가는 세션 참가자(소유 강사/활성 수강생) — 자막 리로드와 같은 게이트(미참가 403 `LIVE_SESSION_FORBIDDEN`, 없는 세션 404). **경로가 `/stream`으로 끝나는 것은 계약이다** — `frontend/nginx/default.conf`의 `location ~ ^/api/.+/stream$`만 `proxy_buffering off`를 적용하므로 다른 접미사(`:stream` 등)면 운영에서 스트리밍이 깨진다. 오류(스트림 **시작 전**): 503 `AI_ANSWER_UNAVAILABLE`(ai-api 503·연결 실패)·409 `AI_ANSWER_REQUEST_CONFLICT`·502 `AI_ANSWER_UPSTREAM_REJECTED`(ai-api 400/401/406 등). **업스트림 401을 401로 흘리지 않는다**(FE가 세션 만료로 오해). 시작 **후** 실패는 상태코드를 바꾸지 않고 `answer.error`(`PROXY_UPSTREAM_FAILED`·`PROXY_STREAM_INCOMPLETE`)로 알린다. 다시보기(replay) AI는 시간 앵커 계약 전이라 **미구현**(ADR-0047 §9). 용어 설명(`terms:explain`)은 미구현 |
| 퀴즈 | `GET /lessons/{id}/quizzes`·`POST /quizzes/{id}/attempts` | 결정론 채점 |
| 채팅 | `GET/POST /live-sessions/{sessionId}/messages` | **세션 키잉(구현됨)**, 본문도 세션 기준. WS 실시간 + REST 보완. **익명은 발신자 선택**([ADR-0050](decisions/songjeongki/0050-chat-anonymity-is-sender-choice.md)) — 전송 `anonymous=true`면 세션 한정 가명(`수강생-0473`), 생략·`false`면 발신자가 지정한 표시 이름. **강사는 요청해도 익명이 되지 않는다.** `userId`는 응답·WS에 넣지 않는다. `mine`(본인 여부, 우측 정렬용)은 **REST 응답에만** 둔다 — 브로드캐스트는 뷰어별이 될 수 없어 라이브 중엔 `clientMessageId` 대조로 판별한다 |
| 라이브 | `POST /instructor/live-sessions/{id}/preflight` · `GET /instructor/live-sessions/{id}/preflight/readiness` · `POST /instructor/live-sessions/{id}/token` · `POST /live-sessions/{id}/start` · `GET /live-sessions/{id}/start-status` · `POST /live-sessions/{id}/end` | LiveKit token은 **소유 강사 WebRTC 송출 전용**이다. 활성 수강생에게도 발급하지 않으며 학생은 `GET /lessons/{id}/playback`의 HLS source로만 시청한다([ADR-0032](decisions/songjeongki/0032-media-playback-hls-only.md)). 학생의 token 요청은 역할 게이트 403, 비소유 강사는 403 `LIVE_SESSION_FORBIDDEN`이며 구 공용 경로 `POST /live-sessions/{id}/token`은 제공하지 않는다. preflight prepare는 **200** `{sessionId,roomName,roomSid}`. 강사 FE가 token으로 실제 room에 연결해 microphone을 publish한 뒤 readiness를 조회하며 **200** `{ready,instructorPresent,microphonePublished,microphoneMuted,instructorMicrophoneTrackCount,unexpectedMicrophonePublishers}`; `ready=true`는 소유 강사·정확히 1개인 unmuted microphone·다른 microphone publisher 없음이다. start는 readiness를 다시 검사하고 **202** `{operationId,sessionId,status:"STARTING"}`를 반환한다(이미 STARTING이면 같은 active operation, LIVE면 `status:"LIVE"`). 상태 조회는 optional `operationId` query와 **200** `{operationId,attemptStatus,step,failureCode,failureMessage,session}`이며 attemptStatus는 `IN_PROGRESS|SUCCEEDED|FAILED`, step은 `ACCEPTED|STT_DISPATCHED|EGRESS_STARTING|EGRESS_READY|PUBLISHER_RECHECK|LIVE|FAILED`. 소유권 위반 403, 없는 세션 404, preflight/상태/recording 조건 위반은 409 `LIVE_SESSION_STATE_CONFLICT`, LiveKit room 준비·participant 조회 실패는 502 `LIVE_ROOM_CONTROL_FAILED`이며 이를 마이크 미준비 409로 숨기지 않는다. 시작 실패의 안정 code는 상태 응답의 `failureCode`(`STT_DISPATCH_FAILED|STT_READINESS_GATE_UNAVAILABLE|EGRESS_START_FAILED|EGRESS_NOT_READY|EGRESS_FAILED|EGRESS_ABORTED|EGRESS_LIMIT_REACHED|INSTRUCTOR_NOT_PUBLISHING|START_FAILED`)로 전달한다. 상세: [ADR-0002](decisions/choinhoo/0002-live-start-egress-stt-orchestration.md). **세션 응답은 `lessonId`까지만 준다 — 커리큘럼·섹션·강의 제목은 담지 않는다**(live 모듈은 curriculum을 참조하지 않는다, [decisions/songjeongki/0007](decisions/songjeongki/0007-domain-live-session.md)). 그 맥락이 필요한 화면은 `lessonId`로 **기존 `GET /lessons/{id}`** 를 읽어 채우며(소유 강사도 열리므로 역할 분기가 없다), 없는 값을 빈 문자열로 채우지 않는다([decisions/seominkyeong/0004](decisions/seominkyeong/0004-live-session-curriculum-context.md)). |

## 3. 내부 계약 (확정 인터페이스)

### 3-1. Spring → AI 배치 잡 (RabbitMQ)
자료 임베딩 잡 envelope(정본은 코드 `InstructorCurriculumService`): 레슨 스코프는 `{ taskType, materialId, assetId, lessonId, curriculumId, fileName, policy{embedModel}, contractVersion }`. taskType: `PPTX_EMBED`(자료 임베딩)·`EMBED_DELETE`(자료 삭제 시 chunk 제거) 등. **커리큘럼 스코프(ADR-0042)**: 레슨이 없으므로 `lessonId` 대신 `scope: "CURRICULUM"`을 싣고 `curriculumId`만 준다(레슨 잡은 `scope` 미포함 = 암묵적 `LESSON`). 워커는 `scope`로 RAG 적재 범위를 정한다 — 이 계약 진화(스코프별 필수 필드)를 소비하는 워커 측 배선은 후속(ai-worker `PptxEmbedJob`의 `lessonId` optional화 필요, `material.embedding.enabled` 기본 off라 미배선 상태에서 무회귀). (라이브 STT는 배치 아님 — Redis Streams §3-4. 트랜스코드는 없음 — VOD=Egress 녹화, [decisions/songjeongki/0010](decisions/songjeongki/0010-self-host-vod.md)) **outbox**로 발행 신뢰성, 실패는 **DLQ**. **워커 파일 접근(B안, 주문형 발급)**: envelope에 파일 위치·URL을 싣지 않는다. 워커가 잡 처리 **직전에** `POST /api/internal/ai/materials/download-url`(본문 `{assetId}`, §3-2와 동일 HMAC 서명)로 갓 서명된 presigned GET URL을 받아 스토리지에서 직접 읽는다 — 자격증명을 워커에 두지 않고, 사용 직전 발급이라 TTL 만료와 무관. chunk 정책(chunkSize·overlap)은 워커 설정 소유(envelope의 `policy`는 `embedModel`만). 상세: [decisions/songjeongki/0036](decisions/songjeongki/0036-material-embedding-pipeline.md).

### 3-2. AI → Spring callback (HTTP, 서명) — 구현됨
`POST /api/internal/ai/callbacks` — permitAll이되 **HMAC-SHA256 서명이 실질 인증**이다(egress webhook 0034와 동일 패턴). 워커가 공유 시크릿(`ai.callback-secret`)으로 **원시 바이트 body**를 서명해 `X-Signature`(base64) 헤더에 실어 보내고, 검증 실패는 401. body: `{ eventId, eventType, jobId, materialId, lessonId, status }`(미지의 필드는 무시). Spring은 `external_event_inbox`에 `(source=ai-worker, eventId)` 복합키로 삽입해 **멱등** 처리(중복이면 무시). eventType → 자료 임베딩 상태 매핑: `MATERIAL_EMBEDDED`→READY, `MATERIAL_EMBED_FAILED`→FAILED, `MATERIAL_EMBEDDING`→PROCESSING, 그 외는 inbox에만 남기고 상태 불변. 코드: `aiintegration/service/AiCallbackService.java`·`web/AiCallbackVerifier.java`. 상세: [decisions/songjeongki/0036](decisions/songjeongki/0036-material-embedding-pipeline.md).

### 3-3. Spring → realtime-agent (LiveKit explicit AgentDispatch) — AI 구현됨, Spring Phase 4a 구현
Spring은 LiveKit room·권한·생명주기를 소유하고, realtime-agent는 Worker 등록과 배정된 STT job을 소유한다. Java의 `agentName`과 Python의 `STT_AGENT_NAME`은 정확히 같아야 하며 assigned/connected room은 모두 `session-{sessionId}`여야 한다. dev는 양쪽 모두 `liveclass-realtime-stt-dev`, prod는 양쪽 모두 `liveclass-realtime-stt-prod`를 사용해 같은 LiveKit의 Worker pool을 환경별로 격리한다. 근거: [ADR-0025](decisions/canola/0025-realtime-agent-spring-handoff-contract.md)·[ADR-0035](decisions/canola/0035-realtime-agent-dual-environment-runtime.md).

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

### 3-4. realtime-agent → application Redis 자막 Stream — AI 구현됨, Spring consumer 구현(ADR-0043·0052)
Redis는 LiveKit 내부 Redis가 아닌 application Redis다. key는 `CAPTION_STREAM_KEY`로 주입하며 기본값은 전역 `ai:captions:live`. 모든 `XADD`에 `MAXLEN ~ CAPTION_STREAM_MAXLEN`(기본 10,000)을 적용한다. entry value는 모두 문자열이고 정수 필드는 부호 없는 최대 18자리 십진 문자열이다.

| `type` | 필수 필드 |
|---|---|
| `caption.delta` | `contractVersion="1"`, `eventId`, `sessionId`, `lessonId`, `sttSessionId`, `sequence`, `streamElapsedMs`, `text`, `occurredAt` |
| `caption.stream.completed` | `contractVersion="1"`, `eventId`, `sessionId`, `lessonId`, `sttSessionId`, `lastSequence`, `streamElapsedMs`, `reason="ROOM_DELETED"`, `occurredAt` |
| `caption.stream.started` | `contractVersion="1"`, `eventId`, `sessionId`, `lessonId`, `sttSessionId`, `audioStartedAt`(UTC=`Z`\|`+00:00`), `occurredAt` |
| `caption.segment.final` | `contractVersion="1"`, `eventId`, `sessionId`, `lessonId`, `sttSessionId`, `segmentIndex`, `lastSequence`, `text`, `startStreamElapsedMs`, `endStreamElapsedMs`, `boundaryReason`(`SILENCE`\|`MAX_DURATION`\|`STREAM_END`), `occurredAt` |

`sequence`·`lastSequence`는 `(sessionId, sttSessionId)` 한 job attempt 안에서만 증가한다. retry는 새 `sttSessionId`에서 `sequence=1`로 시작할 수 있으므로 Spring은 attempt 단위로 접고 at-least-once write는 `eventId`로 중복 제거한다. `streamElapsedMs`는 **agent가 첫 audio frame을 받은 시점을 0으로 한 attempt-local 시간**이지 Spring session clock이 아니다.

agent는 `caption.stream.started`·`caption.segment.final`도 발행한다(!233 병합). `caption.partial|final|revised`는 발행하지 않는다. Spring consumer는 ai-api(`ai-rag-live-v1`)와 **별도 group `spring-caption-live-v1`**로 소비하고(ADR-0043·0052), `eventId` 멱등으로 **네 type 모두 append-only로 core.live_caption에 영속**한다(`started`·`segment.final`은 ADR-0052 신규 컬럼 `audio_started_at`·`segment_index`·`start/end_stream_elapsed_ms`·`boundary_reason`에 적재). WS 실시간 전달·자막 리로드(§3-6)는 표시 대상 `caption.delta`·`caption.stream.completed`·`caption.segment.final`(ADR-0053)을 대상으로 하며, `segment.final`은 신규 `CaptionSegmentPayload`(`sttSessionId`·`segmentIndex`·`lastSequence`·`text`·`startStreamElapsedMs`·`endStreamElapsedMs`·`boundaryReason`·근사 `sessionMs`)로 `/topic/live-sessions/{sessionId}/captions` WS와 리로드에 함께 나간다. `caption.stream.started`(시간 앵커)는 **표시 대상이 아니라 영속만** 한다. RAG `contextTimeMs`(§3-9)는 단일 `streamElapsedMs` 좌표를 갖는 `caption.delta`·`caption.stream.completed`만 대상으로 한다(`started`·`segment.final`은 좌표 없어 제외). FE는 `segment.final`의 권위 텍스트로 발화 단위 렌더하고 문장부호 휴리스틱(ADR-0044)을 제거한다(ADR-0053). raw `streamElapsedMs`를 **그대로 저장·중계**하며 세션 상대 ms로 변환하지 않는다 — session/HLS time-origin 변환·앵커, owner fencing, 전역 key의 session별 분리·정리는 후속 공유 계약이다(전역 key는 producer의 `MAXLEN ~`에 정리를 위임하고 consumer는 키를 DEL하지 않는다). consumer가 소비하는 Redis는 `spring.data.redis`가 가리키는 **환경별 application Redis**다. dev는 Spring service endpoint `redis:6379`와 GPU tunnel `:4000`, prod는 Spring service endpoint `redis:6379`와 GPU tunnel `:6390`을 각각 사용하며 두 caption stream을 섞지 않는다([ADR-0035](decisions/canola/0035-realtime-agent-dual-environment-runtime.md)). 상세: [`caption schema`](../ai/realtime-agent/contracts/schemas/caption-stream-entry.schema.json)·[`delta fixture`](../ai/realtime-agent/contracts/fixtures/caption-delta.valid.json)·[`completion fixture`](../ai/realtime-agent/contracts/fixtures/caption-completed.valid.json)·[ADR-0043](decisions/songjeongki/0043-caption-consumer-persistence.md).

### 3-4a. ai-api → application Redis 실시간 강의 노트 Stream — AI producer 구현, Spring consumer 미구현

ai-api는 §3-4의 자막을 별도 consumer group `ai-live-notes-mvp-v1`로 읽고, 라이브 중에는 새로 생성된 노트
조각만 application Redis Stream `ai:lecture-notes:mvp`에 발행한다. capture 완료 뒤에는 라이브 event를
수정하지 않고 별도 refined snapshot을 한 번 발행한다. Redis String cache는 만들지 않는다. 모든 write는
`XADD ... MAXLEN ~ AI_API_LECTURE_NOTE_STREAM_MAXLEN`(기본 10,000)이며 Redis entry value는 모두 UTF-8
문자열이다.
정수 필드는 부호 없는 최대 18자리 십진 문자열이고, 알 수 없는 필드·누락 필드·중복 필드는 계약 위반이다.

공통 필드는 다음 조건을 지킨다.

| 필드 | 계약 |
|---|---|
| `contractVersion` | 문자열 literal `"1"` |
| `eventId` | 1~128자의 `[A-Za-z0-9][A-Za-z0-9._:-]*`; 논리 event의 전역 멱등 key |
| `sessionId`, `lessonId` | 소문자 canonical UUID |
| `sttSessionId` | `eventId`와 같은 1~128자 identifier; `latestSttSequence`·`lastSttSequence`의 attempt 범위 |
| `occurredAt` | timezone offset을 포함한 RFC 3339 datetime |

| `type` | 추가 필수 필드 |
|---|---|
| `lecture.note.chunk.appended` | `chunkSequence`, `latestSttSequence`, `topicAction`, `topicId`, `topicTitle`, `keyPoints`, `markdownFragment` |
| `lecture.note.capture.completed` | `lastChunkSequence`, `lastSttSequence`, `reason="ROOM_DELETED"` |
| `lecture.note.refined.snapshot` | `sourceLastChunkSequence`, `topics`, `markdownSnapshot` |

`lecture.note.chunk.appended`의 필드 조건은 다음과 같다.

- `chunkSequence`: 세션 범위의 1-based 양의 정수이며 실제 새 조각을 발행할 때만 정확히 1 증가한다.
- `latestSttSequence`: 이 조각이 반영한 마지막 자막 sequence다. `sttSessionId` attempt 안의 1-based
  값이며 세션 전체 자막 번호나 session/HLS ms가 아니다.
- `topicAction`: `START_NEW|CONTINUE`. 세션의 첫 조각은 모델 응답과 무관하게 `START_NEW`다.
- `topicId`: `eventId`와 같은 1~128자 형식이며 세션 안에서 topic을 식별하는 opaque identifier다.
  Backend는 문자열 형식을 해석하지 않는다.
- `topicTitle`: 1~80자의 단일 행 문자열이다.
- `keyPoints`: 논리 payload에서는 1~3개 배열이며 각 항목은 trim·NFC 정규화된 1~300자 단일 행
  문자열이다. Redis field에는 compact JSON 배열 문자열로 싣는다.
- `markdownFragment`: 1~8,192자다. `START_NEW`는 `## 제목`과 bullet을, `CONTINUE`는 새 bullet만
  포함한다. raw HTML·image·외부 link는 허용하지 않고 heading, unordered list, bold, inline code만 허용한다.
- 구조화 `topicAction/topicTitle/keyPoints`가 의미상 정본이며 `markdownFragment`는 동일 값에서 결정론적으로
  만든 파생 표현이다. 둘이 불일치하면 계약 위반이다.

Backend가 전체 Markdown을 단순 결합할 경우 첫 조각은 그대로 저장하고, 이후 `START_NEW` 앞에는 `\n\n`,
`CONTINUE` 앞에는 `\n`을 삽입한다. 또는 구조화 필드를 누적한 뒤 같은 renderer로 전체 Markdown을
다시 만들 수 있다. AI wire event에는 `noteVersion`이 없다. Backend read model이 version을 노출한다면
정상 반영한 chunk 수를 기준으로 별도 관리한다.

`lecture.note.capture.completed`는 해당 세션의 라이브 자막 수집이 끝났다는 append 경로의 terminal event다.
`lastChunkSequence`는 조각이 없으면 `0`, 있으면 마지막 발행 순번이며, `lastSttSequence`는 completion이
가리킨 STT attempt의 마지막 자막 sequence다. completion은 전체 노트가 검수·게시·최종 교정됐다는 의미가
아니다. 정상 completion 뒤 같은 세션의 새 `lecture.note.chunk.appended`는 허용하지 않는다.

`lecture.note.refined.snapshot`은 live draft의 전체 구조화 topic만 입력으로 사용해 capture 완료 뒤 한 번
정제한 별도 전체 snapshot이다. raw caption, 녹화 HLS, 자료 RAG는 다시 입력하지 않는다.

- `sourceLastChunkSequence`: 정제 입력이 된 마지막 live `chunkSequence`와 같은 1-based 양의 정수다.
- `topics`: 1~30개 compact JSON 배열 문자열이다. 각 항목은 정확히 `topicId`, `topicTitle`, `keyPoints`를
  가지며 `topicId`는 세션 refined snapshot 안의 opaque identifier, 제목은 1~80자 단일 행, 요점은
  1~20개의 1~300자 단일 행 문자열이다.
- `markdownSnapshot`: 1~262,144자이며 같은 `topics`에서 결정론적으로 만든 전체 Markdown이다. live
  `markdownFragment`에 append하는 값이 아니라 별도 refined read model을 교체하는 값이다.
- refined snapshot은 live `chunkSequence`를 증가시키거나 과거 chunk event를 수정·취소하지 않는다.
- 재시도는 같은 `eventId`, payload, `occurredAt`을 유지한다. 같은 세션·같은
  `sourceLastChunkSequence`의 뒤늦은 중복 snapshot은 `eventId` 멱등으로 무시한다.

발행 재시도는 최초 event와 **같은 `eventId`, sequence, payload, `occurredAt`**을 사용한다. Spring 구현 시
별도 group `spring-lecture-notes-live-v1`을 `0-0`에서 만들고, 세션별 처리를 직렬화하며 다음 순서로 처리한다.

1. `(source=ai-api, eventId)` 멱등 기록과 노트 조각 누적을 같은 DB transaction에서 처리한다.
2. 이미 처리한 `eventId` 또는 현재 값 이하의 `chunkSequence`는 중복·stale로 기록하고 ACK한다.
3. 기대값보다 큰 `chunkSequence`는 aggregate와 WS를 갱신하지 않고 pending에 남기며 gap metric·log를 남긴다.
4. completion은 `lastChunkSequence`가 현재 정상 반영 순번과 일치할 때만 capture 완료로 반영한다.
5. refined snapshot은 capture 완료가 반영됐고 `sourceLastChunkSequence`가 live 마지막 순번과 일치할 때만
   별도 refined read model 전체를 교체한다. live draft에는 append하지 않는다.
6. DB commit 뒤에만 ACK하고, commit된 새 조각만 Frontend WebSocket으로 전달한다. refined snapshot의
   Frontend 전달 방식은 Spring·Frontend 구현 시 별도로 확정한다.

Spring consumer·DB·REST·WebSocket은 아직 구현되지 않았다. AI producer는 caption과 미처리 작업을
`ai:lecture-notes:mvp:state:{sessionId}`에 저장한 뒤 caption을 ACK하고,
`ai:lecture-notes:mvp:active-sessions`에서 시작 시 복원한다. 발행할 payload를 outbox에 먼저 고정한 뒤 결과
`XADD`와 outbox를 비운 checkpoint 저장을 같은 Redis transaction으로 처리하므로 단일 ai-api 프로세스
재시작에서도 `eventId`, `chunkSequence`, `topicId`를 이어간다. 이 내부 key는 Spring이 소비하거나 수정하지
않는다. Redis 자체 장애 내구성, 여러 ai-api replica의 session owner fencing, 다른 consumer의 pending
회수는 아직 보장하지 않는다. Spring 소비 활성화 전에는 이 제한과 gap 복구 운영 정책을 함께 검토한다.
상세 결정과 현재 제한은 [ADR-0034](decisions/canola/0034-near-realtime-accumulative-lecture-notes.md)를 따른다.

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

### 3-6b. 강사 FE → Egress 합성 화면 판서 (LiveKit 데이터 채널) — FE 양쪽 구현됨
- **topic** `annotation`, **reliable**로 publish. 다른 topic은 판서로 해석하지 않는다.
- **payload** `{ "v": 1, "op": { … } }` (UTF-8 JSON). `v`가 1이 아니면 버린다 — 옛 Egress 페이지가 새 op를 조용히 오해석하면 안 된다.
- **op** 다섯 가지, 모두 `revision`(단조 증가 Long) 필수. `upsert { elements[] }` · `delete { ids[] }` · `clear` · `snapshot { elements[] }` · `pointer`.
- `elements`는 **Excalidraw 요소 JSON 그대로**다. 이것이 판서 문서의 정본 포맷이며, 손그림 → 도형 인식 결과도 같은 형식으로 주입해 편집 가능성을 유지한다([ADR-0051](decisions/songjeongki/0051-instructor-annotation-excalidraw.md)).
- **좌표계는 `1920x1080` 논리 프레임**(§합성 캔버스와 동일). 다만 수신 측은 프레임을 가정하지 않고 `getCommonBounds()`로 **실제 오프셋을 보정**해 얹는다 — `exportToCanvas`가 프레임이 아니라 내용 바운딩 박스 기준으로 그리기 때문이며, `freedraw`의 `points`는 선언된 `x/y/width/height`를 넘을 수 있어 좌표 클램프로는 막지 못한다. 프레임을 벗어난 판서는 CSS로 클립한다(좌표를 잘라내지 않는다).
- **`files`**: `snapshot`·`upsert`는 `files`(=`fileId` → `{ id, mimeType, dataURL, created }`)를 함께 실을 수 있다. Excalidraw 이미지 요소는 데이터를 담지 않고 `fileId`로 **가리키기만** 하므로, 이것 없이는 수신 측에 빈 자리가 남는다 — 강사 화면에는 보이는데 수강생 화면에는 없다. 수식(§3-6e)이 이 경로를 쓴다.
  - `dataURL`은 **자체 완결**이어야 한다(외부 요청 0건). Egress의 헤드리스 Chrome은 외부 폰트·이미지를 받지 못할 수 있다.
  - `upsert`는 **이번에 실린 요소가 가리키는 파일만** 보낸다. 전부 실으면 획 하나를 그을 때마다 판서의 모든 수식이 다시 나간다(수식 하나 6KB대).
  - 수신 측은 `upsert`의 파일을 **더하고**, `snapshot`의 파일로는 **갈아 끼우며**, `delete`·`clear`에서는 **지우지 않는다** — 되돌리기로 요소가 돌아올 수 있고 그때 파일이 없으면 빈 자리가 된다.
- **유실 처리**: `revision`이 이어지지 않으면 그 op를 버리고 다음 전체 상태를 기다린다(반쪽짜리 판서를 녹화하지 않는다). 강사는 **참가자가 새로 접속할 때마다** 전체 상태를 다시 알린다 — 도중에 재접속한 Egress의 유일한 복구 경로다.
- **강사가 단일 writer**다. 그래서 CRDT 없이 `revision` 하나로 충분하고, 같은 op를 두 번 받아도 결과가 같다(멱등).
- 수강생은 이 채널을 구독하지 않는다 — 합성 결과만 본다(ADR-0032). 따라서 판서는 Egress 프레임을 거쳐서만 수강생에게 도달한다.
- **z-order**: 수신 측은 렌더 직전 요소의 `index`(Excalidraw fractional index)로 정렬한다. op에는 순서 정보가 없어 도착 순으로 재구성하면 나중에 온 요소가 항상 맨 위가 된다 — 강사가 아래에 깔아 둔 화이트보드가 수강생 화면에서 판서를 덮는다. 화이트보드(`liveclass-whiteboard`)는 정의상 배경이라 언제나 맨 아래다.
- **전체 상태는 밀지 않고 받아간다 — `pointer`**([ADR-0055](decisions/songjeongki/0055-annotation-full-state-is-pulled.md)). 강사는 판서를 켤 때·새 참가자가 들어올 때 `{ type: "pointer", revision: N }`만 낸다. "여기까지의 전체 상태는 서버에 있다"는 뜻이고, 수신 측은 §3-6d의 `GET`으로 문서를 가져온다.
  - **왜.** 스냅샷은 문서 전체라 판서가 길어질수록 커진다. WebRTC 데이터 채널의 기본 최대 메시지는 **65,536 B**인데 실측(2026-07-31)에서 요소 53개 + 수식 1개가 **74,952 B**로 114%였다. 넘으면 전송이 통째로 실패해 **수강생 화면에 판서가 아예 나오지 않는다** — 강사 화면에는 멀쩡히 보이므로 알아챌 수 없다. 델타(`upsert`·`delete`)는 작고 잦고 지연에 민감하므로 계속 이 채널로 민다.
  - **포인터를 내기 전에 §3-6d의 밀린 저장을 비운다.** 영속화는 1.5초 주기 묶음이라 서버가 강사보다 뒤처져 있고, 그대로 내면 수신 측이 받는 문서와 이후 델타 사이에 구멍이 생긴다. **비우지 못하면 포인터를 내지 않고 예전처럼 `snapshot`을 민다** — 지킬 수 없는 약속을 하지 않는다.
  - **`revision`은 강사의 번호다.** 서버가 매긴 번호가 아니다. 강사는 저장하지 않는 op(`clear`, 빈 스냅샷)에도 번호를 소비하므로 서버 번호는 늘 낮고, 그것을 쓰면 이후 델타가 전부 "중간이 빠졌다"로 버려진다. 수신 측은 **가져온 내용**에 **포인터의 번호**를 붙인다.
  - **수신 측은 먼저 구독하고 나중에 가져온다.** 포인터를 받으면 그 순간부터 도착하는 op를 버퍼에 쌓고, 문서를 받아온 뒤 `revision > N`인 것만 얹는다. 순서가 반대면 왕복이 도는 사이 흐른 op가 사라지고, 그 구멍 때문에 이후 op가 전부 버려진다.
  - **가져오지 못하면 번호만 맞춘다.** 그때까지의 판서는 잃지만, 그러지 않으면 강의가 끝날 때까지 아무것도 나타나지 않는다.
  - **옛 수신 페이지는 이 op를 모르므로 무시한다.** 배포 순서상 잠깐 전체 상태 없이 도는 구간이 생기므로 `snapshot` 경로를 안전망으로 남긴다.
- **혼자서도 기준점이 되는 것은 `snapshot`뿐이다 — 판서가 비어 있어도 보낸다.** 수신 측은 revision 0에서 시작하는데 강사는 서버에서 이어받은 번호(예: 48)부터 매기므로, 이 **기준점**이 없으면 이후 op가 전부 "중간이 빠졌다"로 버려진다. `snapshot`만 revision 검사를 건너뛴다. 강사는 새 페이지에서 접속할 때 **빈 스냅샷**을 한 번 내 번호를 맞춘다(수십 바이트라 크기 문제가 없다).
- **강사 접속 시 복원**: 강사가 새 페이지에서 접속하면(새로고침 포함) §3-6d로 저장된 문서를 불러와 **빈 스냅샷으로 번호를 맞추고**, 판서를 켤 때 `pointer`로 전체 상태를 알린다. 그러지 않으면 ①강사 화면에는 없는 판서가 수강생·녹화에만 남고 ②강사의 revision이 0부터 다시 시작해 이후 op가 전부 "이미 본 op"로 버려진다(`snapshot`만 revision 검사를 건너뛴다). 복원에 실패하면 빈 스냅샷으로 떨어진다 — 판서를 잃더라도 ②는 반드시 막아야 한다.

### 3-6d. 강사 FE → Spring 판서 영속화 (REST) — FE·BE 구현됨
- **라이브 전달 경로가 아니다.** 판서가 수강생에게 닿는 길은 §3-6b(데이터 채널 → Egress)이고, 이 API는 그와 **병렬로** 기록만 남긴다. 그래서 응답을 기다려 화면을 갱신하지 않으며, 저장 실패가 강의를 막지 않는다.
- `POST /api/live-sessions/{sessionId}/annotation/ops` → `202 Accepted`. body는 op **배열**(묶어 보낸다, FE 기본 1.5초 주기). 각 항목 `{ revision, opType: "snapshot|upsert|delete|clear", payload, occurredAt }`.
- `payload`는 op 본문의 **JSON 문자열**이며 **서버는 해석하지 않는다**. Excalidraw가 요소 필드를 늘릴 때마다 서버 마이그레이션이 따라오지 않게 하기 위해서다.
- **멱등**: `(session_id, revision)` UNIQUE. 같은 revision이 다시 와도 중복 적재하지 않으므로 FE는 실패한 묶음을 그대로 재전송한다.
- `GET /api/live-sessions/{sessionId}/annotation` → `{ revision, nextRevision, snapshotPayload, ops[] }`. **마지막 스냅샷과 그 이후 op만** 돌려준다 — 세션 전체를 접으면 강의가 길어질수록 복원이 느려지고, 스냅샷은 그 자체로 전체 상태다. 접는 것은 FE가 한다(같은 로직이 이미 수신 측에 있다).
- **`nextRevision`은 서버가 정한다.** FE가 접힌 문서의 revision으로 대신 채번하면, 저장에 실패한 op가 있을 때 이미 쓴 번호를 다시 써서 Egress가 새 획을 "이미 본 op"로 버린다.
- 복원 시 FE는 §3-6b의 유실 감지(revision 불연속 → 버리고 스냅샷 대기)를 **적용하지 않는다**. 저장된 행은 전송 중 유실이 아니라 실제로 남은 전부이며, 번호가 띄엄하다고 뒤따르는 획까지 버리면 그 이후가 통째로 사라진다.
- **복원 체크포인트**(ADR-0057): `PUT /api/live-sessions/{sessionId}/annotation/snapshot`(body `{revision, payload}`) → `204`, **소유 강사만**. 강사 클라이언트가 문서-변경 op 100건마다 보낸다. **데이터 채널로는 나가지 않는다** — 문서 전체를 채널에 실으면 §3-6b의 64KB 문제가 되돌아온다.
  - **op가 아니다.** 별도 테이블(`core.live_annotation_snapshot`, 세션당 한 행)에 둔다. op 테이블에 넣으면 `(session_id, revision)` UNIQUE에 걸리거나, 새 번호를 소비해 **수신 측에 번호 구멍**이 생겨 그 뒤 op가 전부 버려진다.
  - 복원은 **체크포인트와 `snapshot` op 중 더 최근 것**에서 시작한다. 옛 세션에는 snapshot op가 남아 있고, ADR-0055의 안전망도 그 경로를 쓴다.
  - **뒤로 가는 체크포인트는 무시한다.** 강사가 창을 둘 열면 늦게 온 것이 더 옛 문서일 수 있다.
- **판서 표시 상태**(ADR-0056): `GET` 응답에 `visible`(boolean)이 함께 온다. **op가 아니다** — 저장은 `live_session.annotation_visible`이고 위 `ops` fold에 끼어들지 않는다. 판서 **내용**은 문서에, "지금 보여주는가"는 세션에 둔다. `PUT /api/live-sessions/{sessionId}/annotation/visibility`(body `{visible}`) → `204`, **소유 강사만**.
  - **복원할 때 그 상태를 수신 측에도 반드시 알린다.** 켜짐이면 `pointer`, 꺼짐이면 `clear`. 아무것도 보내지 않으면 강사 화면은 비었는데 Egress는 자기 문서를 계속 그려 **수강생에게만 판서가 남는다** — 강사 화면에서는 정상으로 보이므로 알아챌 수 없다.
  - **화이트보드는 여기 없다.** 그건 문서 안의 요소(`liveclass-whiteboard`)라 이미 저장·복원된다. 강사 화면의 버튼은 그 요소의 존재에서 **파생**한다.
- **인가**: 읽기는 세션 참가자(§자막·채팅과 같은 게이트), **쓰기는 소유 강사만**. 판서의 writer는 강사 하나라는 전제 위에 revision 채번이 서 있다.
- **읽기에 한해 LiveKit 액세스 토큰을 받는다**(ADR-0055). Egress는 `?url=&token=`으로 열리는 헤드리스 Chrome이라 세션 쿠키가 없다. `Authorization: Bearer <livekit-token>`이 오면 서버가 `LIVEKIT_API_SECRET`으로 서명을 검증하고 `video.room` 클레임이 `session-{sessionId}`와 같은지 본다 — 새 시크릿도, 새 발급 경로도 만들지 않는다(LiveKit webhook JWT를 검증하는 방식과 같다). **읽기 전용이다.** 이 경로로는 쓸 수 없다. 거부 사유는 구분해 알려주지 않는다(서명 실패와 방 불일치를 가르면 탐색에 쓰인다).
- **전달에만 쓰는 op는 저장하지 않는다 — `clear`·빈 스냅샷·`pointer`.** 복원이 마지막 스냅샷부터 접기 때문에, 문서를 담지 않은 op가 그 자리에 앉으면 그 앞의 판서가 통째로 사라진다. `clear`는 지우기가 아니라 강사가 판서를 껐을 때 수강생 화면에서 감추라는 **표시 상태**이고(§3-6b), 빈 스냅샷은 수신 측 **revision 기준점**을 잡는 장치라 페이지를 열 때마다 하나씩 나간다. 문서가 실제로 비는 것은 `delete`로 기록되므로 빈 스냅샷을 남길 이유가 없다. `pointer`는 문서가 아니라 "전체 상태는 서버에 있다"는 안내라 담을 내용이 없다. 셋 다 라이브 전달에는 그대로 나간다.
- **`clear`는 저장하지 않는다.** 그건 문서를 지우는 편집이 아니라 강사가 판서를 껐을 때 수강생 화면에서 감추라는 **표시 상태**다(§3-6b). 강사의 문서는 그대로 남아 다시 켜면 돌아오므로, 저장하면 서버 쪽 문서만 비어 새로고침했을 때 판서가 통째로 사라진다. 라이브 전달에는 그대로 나간다.
- **복원 직후 내보내는 스냅샷은 비어 있다.** 새로고침하면 판서는 꺼진 상태로 시작하므로, 복원한 내용을 그때 내보내면 강사에게는 안 보이는 판서가 수강생 화면에만 뜬다(§3-6b 불변식 위반). 빈 스냅샷은 **revision 기준점** 역할만 한다 — 수신 측은 0에서 시작하는데 강사는 `nextRevision`부터 매기므로, 기준점이 없으면 이후 op가 전부 "중간이 빠졌다"로 버려진다. 내용은 강사가 판서를 켤 때 나간다.
- `session_ms`(세션 상대 ms, 근사 — ADR-0045와 같은 축)를 각 op에 함께 적재한다. 다시보기에서 "강사가 이걸 강조한 순간"으로 이동하는 앵커이며, 그 구간 판서를 RAG 컨텍스트로 쓰는 후속의 입력이다.
- 레이저(§3-6c)는 저장하지 않는다.

### 3-6e. 강사 FE → Spring 판서 해석 (REST) — 설계 확정, 구현 전

근거: [ADR-0054](decisions/songjeongki/0054-annotation-ai-semantics-not-coordinates.md).

- **원칙: 의미만 모델에게 묻고 좌표는 클라이언트가 계산한다.** 실측에서 모델이 낸 도형 좌표는 최대 **96px**(그림 크기의 2~13%) 틀렸고, 같은 도형의 좌표는 획의 `points`에서 오차 없이 얻는다. 그래서 **응답에 좌표가 들어오지 않는다.**
- `POST /api/live-sessions/{sessionId}/annotation/interpret` → `200 OK`.
- **인가는 소유 강사만**(§3-6d 쓰기와 같은 게이트). 판서 문서를 고치는 행위다.
- 요청 `{ mode, image, elementIds[] }`
  - `mode`: `"diagram" | "math"`. 도형 정리(사각형·원·직선)는 **이 API를 쓰지 않는다** — 클라이언트 기하 계산이다(ADR-0054 결정 4).
  - `image`: 강사가 **선택한 영역**만 렌더한 PNG(base64 data URI, 상한 6MB). 선택 내용의 바운딩 박스만 담기므로 **이미지 원점은 프레임 원점이 아니다** — 이 이미지에서 좌표를 읽어 낼 수 없고, 읽을 필요도 없다. 좌표는 클라이언트가 획의 `points`에서 오차 없이 얻는다.
  - `elementIds[]`: 강사가 선택한 요소 id. 모델이 "어느 요소를 바꿀지" 맞히게 하지 않고 **강사의 선택을 스코프로 넘긴다** — 응답의 `replace`가 여기서 나온다.
  - **좌표는 보내지 않는다.** 서버는 좌표를 쓰지 않고(배치는 클라이언트가 원본 획의 `points`에서 계산한다), 쓰지 않을 값을 실어 보내면 계약이 그만큼 넓어져 나중에 누군가 그것을 근거로 삼는다.
- 응답 `{ kind, definition | latex, replace[], confidence, unreadable }`
  - `kind: "mermaid"` — `definition`은 mermaid 정의 **전체**이며 **좌표를 담지 않는다.** 배치는 클라이언트가 `@excalidraw/mermaid-to-excalidraw`로 계산한다(브라우저 전용 — mermaid가 글자 폭을 실측하므로 `getBBox`가 필요하다).
  - `kind: "latex"` — `latex`는 수식 문자열. 놓을 자리와 크기는 원본 획의 bbox에서 클라이언트가 정한다.
  - `replace[]`: 지울 요소 `id` 목록. 요청 `elements[]`의 부분집합이어야 한다.
  - `unreadable: true`면 `definition`·`latex`를 쓰지 않는다(§3-9의 `answer.insufficient`와 같은 자리).
- **`confidence`를 판단 근거로 쓰지 않는다.** 실측에서 **틀린 라벨에 1.0**이 붙었다. 강사에게 보여 주는 참고값일 뿐이다.
- **결과는 확인 없이 바로 적용한다.** 매번 확인을 받으면 강의 흐름이 끊기고, 잘못 나온 것을 되돌리는 비용이 훨씬 싸다. 다만 그 주입은 **되돌리기 스택에 올라가야 한다** — 되돌릴 수 없으면 확인을 없앤 것이 손해가 된다.
- **적용은 강사 클라이언트가 한다. 서버는 판서를 publish하지 않는다.** 주입 뒤에는 기존 경로를 그대로 탄다(`onChange` → diff → §3-6b 데이터 채널 → §3-6d 영속화). 판서의 writer가 강사 하나라는 §3-6b의 전제가 이렇게 유지된다 — 서버가 끼어들면 revision이 충돌하고, 그 어긋남은 **강사 화면에 드러나지 않는다.**
- **Spring이 GMS를 직접 호출한다. ai-api를 거치지 않는다**(ADR-0054 결정 7). 이 해석에는 검색·임베딩·자막 컨텍스트가 없어 파이썬이 할 도메인 일이 없다. RAG 컨텍스트가 필요해지면 그때 ai-api로 옮기며, **이 절의 FE ↔ Spring 계약은 그대로다.**
- **브라우저는 GMS를 직접 부르지 않는다** — 키가 클라이언트에 노출된다.

### 3-6c. 강사 FE → Egress 레이저 포인터 (LiveKit 데이터 채널) — FE 양쪽 구현됨
- **topic** `annotation-laser`, **lossy**(`reliable: false`)로 publish. 판서 op와 <b>같은 채널에 섞지 않는다</b> — 초당 수십 건이고 1초면 사라지므로 revision을 태우면 유실 감지가 의미를 잃는다.
- **payload** `{ "v": 1, "laser": { "phase": "start|move|end", "points": [{ "x", "y", "t" }], "zoom": number } }`
- 레이저는 Excalidraw의 **scene 요소가 아니다**(사라지는 궤적을 별도 오버레이가 그린다). 그래서 `onChange`에 잡히지 않고 판서 op 경로로는 수강생에게 도달하지 않는다 — 강사 FE가 포인터 좌표를 직접 주워 보낸다.
- **포인터를 누르고 있는 동안만** 보낸다(Excalidraw가 `button === "down"`일 때만 궤적을 만든다). 그냥 움직이는 것으로는 아무것도 그려지지 않아야 한다.
- `t`는 강사 시계 기준 단조 시각이며 `LaserPointer`의 `pressure` 자리에 들어가 감쇠 계산에 쓰인다(Excalidraw도 `addPoint([x, y, performance.now()])`로 같게 한다). 수신 측 시계로 계산하면 시계 차이만큼 잔상 길이가 어긋난다.
- `zoom`은 굵기 보정용이다. Excalidraw는 외곽선을 `size / zoom`으로 만든 뒤 viewport로 변환해(× zoom) 늘 화면 2px을 낸다 — 수신 측이 이 보정을 못 하면 강사 창이 작을수록 궤적이 가늘어진다.
- 저장하지 않는다. 다시보기에는 Egress 합성 프레임에 **픽셀로** 남는다.

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

prod GPU agent는 `127.0.0.1:8081`에서 EC2 `127.0.0.1:18081`로, dev GPU agent는
`127.0.0.1:8082`에서 EC2 `127.0.0.1:18082`로 reverse tunnel을 연다. EC2 host에서는 각 reverse
tunnel 주소로 상태를 확인할 수 있고 host-network nginx는 container용 내부 prefix를 제공하지만 Spring
health consumer는 아직 구현하지 않았다. 18081·18082는 public bind하지 않는다.

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

{"requestId":"...","lessonId":"...","curriculumId":"...","sessionId":"...","question":"...","contextTimeMs":0,"issuedAtMs":1785120000000}
```

**본문 필드는 이 7개가 전부다 — 더도 덜도 안 된다.** ai-api의 요청 모델이 `extra="forbid"`라 필드를 늘리면 거부되고, 필수 필드가 빠져도 거부된다. 그리고 그 거부는 422가 아니라 **400**으로 온다(ai-api가 `RequestValidationError`를 400으로 매핑). 실제로 `curriculumId`가 빠져 라이브 AI 질문이 이틀 동안 전부 400으로 죽었다(2026-07-30~08-01) — 양쪽이 각자 테스트를 통과하며 계약만 갈라졌고, **운영에서 질문을 눌러야만** 드러났다. 그래서 Spring 쪽에 이 필드 집합을 고정하는 계약 테스트를 둔다(`RagAnswerWireContractTest`), ai-api 쪽 정본은 `app/rag/models.py::RagAnswerRequest`다.

- `lessonId`·`curriculumId`·`sessionId`는 **서버가 세션에서 조회한 값**이다(클라 입력 신뢰 금지). 소문자 canonical UUID 문자열.
- `curriculumId`는 ai-api의 **자료 검색 범위**다 — PPTX 검색이 레슨이 아니라 커리큘럼 단위이고([ADR-0042](decisions/songjeongki/0042-curriculum-material-attach-and-embedding-scope.md)), 근거의 커리큘럼이 다르면 버린다.
- `issuedAtMs`는 **전송 직전**에 찍는다. 수신 시각과 60초 이상 차이나면 401이므로 명령을 만든 시각을 쓰면 안 된다.
- `question`은 사용자가 보낸 그대로 — 임의 trim·정규화 금지.

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
