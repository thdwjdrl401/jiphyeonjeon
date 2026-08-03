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
| 녹화강의 업로드 | `POST /instructor/sections/{sectionId}/recorded-lessons` · `POST /instructor/recorded-lessons/{lessonId}/video/upload-requests` · `POST .../video/complete` · `GET .../processing` · `POST .../processing/retry` | **구현됨([ADR-0008](decisions/choinhoo/0008-recorded-lesson-upload-and-hls-transcoding.md))**. 소유 강사 전용이며 기존 라이브 생성 API와 분리한다. 생성 요청은 `{clientRequestId,title,description}`이고 **201** `{lessonId,recordedVideoId,deliveryType:"RECORDED",processingStatus:"AWAITING_UPLOAD"}`; `clientRequestId` 재전송은 같은 강의를 반환하고 다른 섹션·제목에 재사용하면 409 `RECORDED_LESSON_IDEMPOTENCY_CONFLICT`다. 티켓 요청 `{fileName,contentType:"video/mp4",fileSize}`은 **201** `{assetId,uploadUrl,method:"PUT",headers,expiresAt}`이고 MP4·최대 5GiB만 허용한다. 브라우저가 스토리지에 직접 PUT한 뒤 완료 요청 `{assetId}`은 **202** `{lessonId,recordedVideoId,jobId,status:"QUEUED",failureCode,durationMs,sizeBytes,readyAt}`를 반환한다. 처리 상태는 `AWAITING_UPLOAD|QUEUED|TRANSCODING|VERIFYING|READY|FAILED`; 실패만 retry 가능하며 **202**다. `QUEUED|TRANSCODING|VERIFYING` 중 레슨 삭제는 409 `RECORDED_VIDEO_DELETE_WHILE_PROCESSING`, 그 외 삭제는 MP4·HLS를 커밋 뒤 정리한다. 기능 스위치 off는 503 `RECORDED_VIDEO_DISABLED`, 잘못된 원본 400, 상태 충돌 409, 비소유 403, 없음 404다. |
| 녹화강의 재생 | `GET /lessons/{lessonId}/recorded-playback` · `GET /lessons/{lessonId}/recorded-playback/manifest` | 활성 수강생과 소유 강사가 `READY` 녹화강의를 HLS로 재생한다. metadata는 `{lessonId,recordedVideoId,durationMs,source:{url,availableFromMs:0,availableToMs}}`; manifest는 `application/vnd.apple.mpegurl`, `Cache-Control: no-store`이며 세그먼트 URI를 presigned GET으로 안전하게 재작성한다. 준비 전 409 `RECORDED_VIDEO_NOT_READY`, 미수강 403 `ENROLLMENT_REQUIRED`, 스토리지 장애 503 `PLAYBACK_STORAGE_UNAVAILABLE`다. 라이브 다시보기 `/playback`과 URL·상태·시간축을 공유하지 않는다. |
| 자료 | `POST /instructor/lessons/{id}/materials` (PPTX) | presigned→MinIO. 자료 API는 PPTX만 처리하고 녹화 영상은 위 전용 API를 사용한다. 본문은 `{"assetId":"..."}`(먼저 에셋으로 올린 PPTX를 연결, multipart 아님). 소유 강사만(비소유 403·없는 레슨 404), 성공 **201** `{materialId, assetId, fileName, status}`. 같은 (레슨,에셋) 중복 연결 **409** `MATERIAL_ALREADY_ATTACHED`(DB 부분 유니크 인덱스로 동시요청도 차단), 잘못된 에셋(없음·kind 불일치·미완료·업로더 불일치) **400** `MATERIAL_INVALID`. 레슨 상세(`GET /lessons/{id}`)·커리큘럼 상세·**강사 관리용 `GET /instructor/lessons/{id}`**의 `materials`는 연결된 활성 자료로 채워지되, **커리큘럼 상세는 ENROLLED·OWNER_INSTRUCTOR에게만 노출**(게스트·미수강자는 빈 목록). **삭제** `DELETE .../materials/{materialId}`(소프트, 멱등)·**다운로드** `GET .../materials/{materialId}/download`(presigned 302). 자료 응답에 **`embeddingStatus`**(PENDING/PROCESSING/READY/FAILED, [0036](decisions/songjeongki/0036-material-embedding-pipeline.md)) — 임베딩 파이프라인(outbox→RabbitMQ→AI→pgvector→콜백)은 스위치(`material.embedding.enabled`) 뒤, 기본 off라 지금은 READY. **AI 콜백** `POST /api/internal/ai/callbacks`(§3-2, HMAC 서명·inbox 멱등)로 상태 확정 ([decisions/songjeongki/0035](decisions/songjeongki/0035-lesson-material-attach.md), [0036](decisions/songjeongki/0036-material-embedding-pipeline.md)). **커리큘럼-레벨 자료(ADR-0042)**: 같은 계약을 스코프만 달리해 `POST/DELETE /instructor/curriculums/{id}/materials[/{materialId}]`·`GET .../download`으로 제공(레슨 자료와 대칭 — 201·409·400·204·302 동일, 같은 `material_asset` 테이블). 커리큘럼 공통 자료는 **강사 관리용 `GET /instructor/curriculums/{id}`의 `materials`**와 공개 상세(`GET /curriculums/{id}`, ENROLLED·OWNER_INSTRUCTOR 게이트)에 함께 노출된다 ([decisions/songjeongki/0042](decisions/songjeongki/0042-curriculum-material-attach-and-embedding-scope.md)) |
| 에셋 | `POST /assets/upload-requests` → presigned `PUT` → `POST /assets/{id}/complete` | 바이트는 앱 서버를 통과하지 않는다. 받은 `assetId`를 도메인 요청에 실어 보낸다(커리큘럼 `thumbnailAssetId`, 프로필 `assetId`, 레슨 자료 `assetId`). kind별 발급: **PROFILE_IMAGE는 인증된 누구나**, **THUMBNAIL·MATERIAL은 강사만**(학생 403). MATERIAL은 **PPTX만·50MiB**, 이미지 kind는 jpeg·png·webp·5MiB — 형식·크기 위반은 400. `RECORDED_VIDEO_SOURCE`는 내부 kind라 generic API 요청은 400 `ASSET_KIND_NOT_PUBLIC`이며 녹화강의 전용 API만 발급한다 ([decisions/songjeongki/0023](decisions/songjeongki/0023-asset-presigned-upload.md), [0035](decisions/songjeongki/0035-lesson-material-attach.md), [choinhoo/0008](decisions/choinhoo/0008-recorded-lesson-upload-and-hls-transcoding.md)) |
| 다시보기 | `GET /lessons/{id}/playback` · `GET /lessons/{id}/playback/manifest` · `GET /instructor/live-sessions/{id}/processing` · `POST /instructor/lessons/{id}/replay-review/publish` · `POST /instructor/lessons/{id}/replay-review/withdraw` · `POST /webhooks/livekit` | **라이브 되감기·종료 후 재생 API 구현됨**([decisions/choinhoo/0001](decisions/choinhoo/0001-live-replay-playback-api.md), [decisions/songjeongki/0039](decisions/songjeongki/0039-replay-playback-api.md)). metadata 응답은 `{lessonId, videoAssetId, sessionId, startedAt, liveSessionStatus, replayStatus, currentSessionMs, sessionOffsetMs, durationMs, source}`이고 `source`는 `{url, availableFromMs, availableToMs}` 또는 manifest 생성 전이면 `null`이다. `replayStatus`는 영상 공개 상태이며 AI 게시 상태와 별개다. **STARTING은 준비 상태 조회만 허용하고, manifest가 이미 있어도 `source=null`이며 manifest endpoint는 409 `RECORDING_STARTING`이다. 실제 HLS source는 원자적 LIVE 전환 뒤에만 공개한다.** source는 하나다 — 라이브 중 재생목록은 `#EXT-X-ENDLIST` 없이 자라는 EVENT 목록이라 라이브 엣지와 세션 처음까지의 seek을 한 목록이 동시에 준다. `url`은 인증된 manifest endpoint이며 `application/vnd.apple.mpegurl`·`Cache-Control: no-store`; 그 본문의 일반 세그먼트와 `EXT-X-MAP/KEY` URI를 presigned GET으로 재작성한다. **라이브 중에는 `#EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL`(기본 60s, `video.playback.can-skip-until`)로 델타 재생목록을 광고하고, 플레이어가 `_HLS_skip=YES`로 다시 물으면 경계보다 오래된 세그먼트를 `#EXT-X-SKIP:SKIPPED-SEGMENTS=N`으로 생략한다**(RFC 8216bis §6.2.5.1). 생략은 삭제가 아니라 병합 지시라 `EXT-X-MEDIA-SEQUENCE`가 불변이고 플레이어 진행 바는 강의 전체를 유지한다. 종료 후 재생목록은 ENDLIST가 있어 플레이어가 다시 받지 않으므로 델타를 쓰지 않는다. 학생은 활성 수강 + 레슨 PUBLISHED가 필수이고 실제 HLS는 LIVE부터 공개한다. **기존 classroom 시청자는 `session.ended` 뒤에도 `VideoAsset FINALIZING/VERIFYING → READY` 동안 같은 HLS와 manifest 갱신을 유지하고 마지막 버퍼까지 소비한다. 별도 송출 종료 안내를 표시하거나 player를 중단하지 않는다.** 새로 다시보기에 진입하는 학생에게만 `READY + replay PUBLISHED` 게이트를 적용한다([ADR-0005](decisions/choinhoo/0005-ended-hls-caption-drain.md), 목표 계약·코드 반영 필요). 새 정상 녹화는 성공 webhook의 한 DB 트랜잭션에서 `VideoAsset READY + ReplayStatus PUBLISHED`가 되어 즉시 학생에게 공개된다([ADR-0007](decisions/choinhoo/0007-recording-ready-auto-publish-and-processing-polling.md), **구현됨**). 기존 `READY + DRAFT`와 `WITHDRAWN`은 자동 공개하지 않으며 수동 publish API는 기존 자산·철회 후 재게시 용도로 유지한다. 소유 강사는 게시 전에도 미리보기한다. 첫 PDT − 세션 시작시각을 `sessionOffsetMs`로 요청마다 계산한다. 세그먼트 URL TTL은 `video.playback.segment-url-ttl`(기본 **6h**) — **델타는 옛 세그먼트 URL을 다시 주지 않으므로 강의 길이보다 짧으면 오래 시청한 학생의 되감기가 403이 된다**. 세그먼트는 공개 도메인(`video.playback.public-endpoint`)으로 서명해 nginx `/recordings/`로 서빙하며, backend가 매니페스트를 읽는 내부 주소(`livekit.egress.s3-endpoint`)와 다르다(SigV4가 Host를 서명에 포함). manifest 생성 지연 409 `RECORDING_STARTING`, 새 replay 진입의 종료 자산 미준비·manifest 유실 409 `REPLAY_NOT_READY`, 스토리지 장애 503 `PLAYBACK_STORAGE_UNAVAILABLE`; 세그먼트 403/장시간 일시정지 뒤에는 같은 URL을 다시 로드한다. 게시·철회는 소유 강사만, 둘 다 204 멱등이며 게시에는 READY가 필요하고 라이브 중 철회는 409 `REPLAY_WITHDRAW_WHILE_LIVE`다. 검수 데이터 저장(`PUT .../replay-review`)은 CP2·CP3 산출물이 없어 미구현. LiveKit webhook은 JWT 검증 후 자산 READY/FAILED와 녹화 통계를 멱등 확정하고, 정상 자동 게시 경로에서는 READY와 PUBLISHED를 함께 커밋한다([0034](decisions/songjeongki/0034-egress-completion-webhook.md), [ADR-0007](decisions/choinhoo/0007-recording-ready-auto-publish-and-processing-polling.md)). |
| 학습 | `GET /lessons/{id}/learning-context`·`PUT /lessons/{id}/progress`·`POST .../bookmarks` | **구현됨**(learning 배선, [decisions/songjeongki/0033](decisions/songjeongki/0033-learning-progress-wiring.md)). 수강자만(미수강 403 `ENROLLMENT_REQUIRED`, 없는 레슨 404). 진도율은 **클라이언트 계산·서버 저장**(0~100), 90% 넘으면 완료(sticky), `clientUpdatedAt`으로 순서역전 방어. 북마크는 멱등. **카탈로그 `progress`는 이제 활성 수강자에게 채워진다**(완료 레슨 수 기준, 상세·내 수강 목록). **구간별 시청 횟수(구현됨, [ADR-0063](decisions/songjeongki/0063-watch-heatmap-buckets.md))**: `PUT /lessons/{id}/watch-buckets`가 `{bucketSizeMs, counts:{칸번호:재생횟수}}`를 받고, `GET /lessons/{id}/watch-buckets/me`가 내 누적을, `GET /lessons/{id}/watch-heatmap?durationMs=`가 그래프를 준다. **칸 길이는 10,000ms 고정**(다른 값이면 400 — 칸 번호가 다른 구간을 가리키게 된다)이고 축은 **세션 상대 ms**라 라이브 되감기와 종료 후 재시청이 같은 칸에 쌓인다. **누적 절대값**을 보내며 서버는 큰 쪽을 남긴다(재전송이 횟수를 부풀리지 않는다). 그래프는 절대 합이 아니라 **재생 횟수 ÷ 그 칸에 도달한 사람 수**이고(합만 그리면 이탈 때문에 우하향이 된다) 강의 길이와 무관하게 **최대 100점**으로 묶어 준다. **강사 재생은 기록하지 않는다**(검수하며 되감은 것이 학생 재시청으로 잡히면 그래프가 오염된다). 보고·내 누적은 수강생 게이트, 그래프는 **소유 강사도 통과**한다(`ensureCanViewInsights`). `watched_ranges` 컬럼은 이 칸 방식으로 대체됐다 |
| 내 수강·대시보드 | `GET /me/enrollments`·`GET /me/learning-summary`·`GET /instructor/dashboard-summary` | **항목마다 커리큘럼 카드 동봉(구현됨)** — 목록을 받고 커리큘럼을 건건이 다시 조회하지 않도록. **학습 요약(구현됨)**: 활성 수강 전반의 `inProgressCurriculumCount`·`completedCurriculumCount`·`averageProgress`(0~100)·`completedLessonCount`와 `todayLiveSession`(가장 이른 예정/진행 라이브, 없으면 null). 로그인 필요, 비학생·수강 없음은 0 요약. **강사 대시보드 요약(구현됨)**: `GET /instructor/dashboard-summary` — `totalCurriculumCount`·`publishedCurriculumCount`·`upcomingLiveCount`·`totalEnrolleeCount`와 `todayLiveSession`([decisions/songjeongki/0041](decisions/songjeongki/0041-instructor-authoring-reads-and-autosave.md)). 소유 모듈은 curriculum |
| 자막/용어 | `GET /lessons/{id}/glossary`·`PUT /instructor/lessons/{id}/glossary` · **`GET /live-sessions/{sessionId}/captions`** | **용어집(구현됨, [ADR-0064](decisions/songjeongki/0064-lesson-glossary-two-layers.md))**: `GET /lessons/{id}/glossary`가 `[{termId, term, definition, source}]`를 준다. **두 겹을 읽을 때 합친다** — 베이스는 `ai.material_key_term`(AI가 PPTX에서 뽑은 것, ai-worker 소유·MR !228), 덮어쓰기는 `core.lesson_glossary_override`(강사). 같은 `term`이 양쪽에 있으면 강사 쪽이 이기고, 강사 쪽에만 있으면 **추가된 용어**다(추가용 표를 따로 두지 않는다). **ai 스키마는 읽기만 한다**(§4) — 복사하면 두 벌이 갈라진다. 표가 없는 환경(로컬·테스트)에서는 원본 없이 강사 수정본만 준다. 키는 **용어 이름**이다 — ai 쪽 PK가 자료 버전을 포함해 재업로드마다 바뀌는데 그걸 참조하면 강사 수정이 끊긴다. 수정·추가는 `PUT /instructor/lessons/{id}/glossary` `{term, definition}`(같은 용어면 덮어쓰기, 멱등). **자막 매핑은 서버가 하지 않는다** — 자막은 WS로 실시간 도착하고 화면이 용어집을 이미 들고 있어, 도착한 줄에서 정규식(대소문자·띄어쓰기 무시)으로 찾는 편이 짧다. transcript는 미구현. **라이브 자막 리로드(구현됨, CAPTION-01/[ADR-0045](decisions/songjeongki/0045-live-caption-position-sync-approx-session-ms.md))**: 저장된 `core.live_caption`을 세션-ms 순으로 반환하며 각 항목은 WS 델타/종료 payload와 **같은 필드**(`type`·`sttSessionId`·`sequence`·`lastSequence`·`streamElapsedMs`·근사 `sessionMs`·`text`·`reason`·`occurredAt`)다. 인가는 세션 참가자(소유 강사/활성 수강생, 미참가 403). FE가 새로고침·재연결 뒤 WS 누적기에 그대로 시드해 자막을 복원한다. |
| AI | **`POST /live-sessions/{sessionId}/ai/answers/stream`(SSE, 구현됨)** · `/lessons/{id}/ai/terms:explain` | **라이브 AI 질의응답(AI-QUESTION-01, [ADR-0047](decisions/songjeongki/0047-live-ai-answer-sse-proxy.md))**: 요청 `{question}`(1~4,000자, 서버가 trim하지 않음)만 받고 `lessonId`·`contextTimeMs`·`requestId`는 **서버가 채운다**(클라 입력 신뢰 금지). 응답은 `text/event-stream`으로 **ai-api 이벤트를 변환 없이 그대로 릴레이**한다 — `answer.delta{requestId,text}` 0개 이상 + `answer.done{requestId,sources}`\|`answer.insufficient{requestId,message}`\|`answer.error{requestId,code,message,retryable}` **정확히 하나**(§3-9). 인가는 세션 참가자(소유 강사/활성 수강생) — 자막 리로드와 같은 게이트(미참가 403 `LIVE_SESSION_FORBIDDEN`, 없는 세션 404). 세션 상태는 **`LIVE`·`ENDING`·`ENDED`에서 질문 허용**, 시작 전·취소·실패 상태는 409 `LIVE_SESSION_STATE_CONFLICT`다([ADR-0004](decisions/choinhoo/0004-ended-session-conversation.md)). **경로가 `/stream`으로 끝나는 것은 계약이다** — `frontend/nginx/default.conf`의 `location ~ ^/api/.+/stream$`만 `proxy_buffering off`를 적용하므로 다른 접미사(`:stream` 등)면 운영에서 스트리밍이 깨진다. 오류(스트림 **시작 전**): 503 `AI_ANSWER_UNAVAILABLE`(ai-api 503·연결 실패)·409 `AI_ANSWER_REQUEST_CONFLICT`·502 `AI_ANSWER_UPSTREAM_REJECTED`(ai-api 400/401/406 등). **업스트림 401을 401로 흘리지 않는다**(FE가 세션 만료로 오해). 시작 **후** 실패는 상태코드를 바꾸지 않고 `answer.error`(`PROXY_UPSTREAM_FAILED`·`PROXY_STREAM_INCOMPLETE`)로 알린다. **질문 기록(구현됨, [ADR-0062](decisions/songjeongki/0062-live-ai-answer-history.md))**: `GET /api/live-sessions/{sessionId}/ai/answers`가 **내가 한 질문만** 물어본 순서로 돌려준다 — `{requestId, question, answer, sources, status(DONE|INSUFFICIENT|ERROR), failureCode, askedAt}`. 개인 질문이라 `userId`가 조회 조건에 반드시 들어간다(남의 질문이 보이면 무엇을 모르는지가 드러난다). 스트림이 끝날 때 서버가 한 번 저장하며 `requestId`가 멱등키다. terminal 없이 끊긴 답변도 받은 데까지 남긴다(`status=ERROR`, `failureCode=PROXY_STREAM_INCOMPLETE`) — 새로고침했다는 이유로 읽던 것을 잃지 않는다. 인가는 스트림과 같은 게이트. 다시보기(replay) AI는 시간 앵커 계약 전이라 **미구현**(ADR-0047 §9). 용어 설명(`terms:explain`)은 미구현 |
| 퀴즈 | `GET /lessons/{id}/quizzes`·`POST /quizzes/{id}/attempts` | 결정론 채점 |
| 채팅 | `GET/POST /live-sessions/{sessionId}/messages` | **세션 키잉(구현됨)**, 본문도 세션 기준. WS 실시간 + REST 보완. 메시지 작성은 **`LIVE`·`ENDING`·`ENDED`에서 허용**하고 시작 전·취소·실패 상태는 409 `LIVE_SESSION_STATE_CONFLICT`다([ADR-0004](decisions/choinhoo/0004-ended-session-conversation.md)). **익명은 발신자 선택**([ADR-0050](decisions/songjeongki/0050-chat-anonymity-is-sender-choice.md)) — 전송 `anonymous=true`면 세션 한정 가명(`수강생-0473`), 생략·`false`면 발신자가 지정한 표시 이름. **강사는 요청해도 익명이 되지 않는다.** `userId`는 응답·WS에 넣지 않는다. `mine`(본인 여부, 우측 정렬용)은 **REST 응답에만** 둔다 — 브로드캐스트는 뷰어별이 될 수 없어 라이브 중엔 `clientMessageId` 대조로 판별한다 |
| 라이브 | `POST /instructor/live-sessions/{id}/preflight` · `GET /instructor/live-sessions/{id}/preflight/readiness` · `POST /instructor/live-sessions/{id}/token` · `POST /live-sessions/{id}/start` · `GET /live-sessions/{id}/start-status` · `POST /live-sessions/{id}/end` | LiveKit token은 **소유 강사 WebRTC 송출 전용**이다. 활성 수강생에게도 발급하지 않으며 학생은 `GET /lessons/{id}/playback`의 HLS source로만 시청한다([ADR-0032](decisions/songjeongki/0032-media-playback-hls-only.md)). 학생의 token 요청은 역할 게이트 403, 비소유 강사는 403 `LIVE_SESSION_FORBIDDEN`이며 구 공용 경로 `POST /live-sessions/{id}/token`은 제공하지 않는다. preflight prepare는 **200** `{sessionId,roomName,roomSid}`. 강사 FE가 token으로 실제 room에 연결해 microphone을 publish한 뒤 readiness를 조회하며 **200** `{ready,instructorPresent,microphonePublished,microphoneMuted,instructorMicrophoneTrackCount,unexpectedMicrophonePublishers}`; `ready=true`는 소유 강사·정확히 1개인 unmuted microphone·다른 microphone publisher 없음이다. start는 readiness를 다시 검사하고 **202** `{operationId,sessionId,status:"STARTING"}`를 반환한다(이미 STARTING이면 같은 active operation, LIVE면 `status:"LIVE"`). 상태 조회는 optional `operationId` query와 **200** `{operationId,attemptStatus,step,failureCode,failureMessage,session}`이며 attemptStatus는 `IN_PROGRESS|SUCCEEDED|FAILED`, step은 `ACCEPTED|STT_DISPATCHED|EGRESS_STARTING|EGRESS_READY|PUBLISHER_RECHECK|LIVE|FAILED`. 소유권 위반 403, 없는 세션 404, preflight/상태/recording 조건 위반은 409 `LIVE_SESSION_STATE_CONFLICT`, LiveKit room 준비·participant 조회 실패는 502 `LIVE_ROOM_CONTROL_FAILED`이며 이를 마이크 미준비 409로 숨기지 않는다. 시작 실패의 안정 code는 상태 응답의 `failureCode`(`STT_DISPATCH_FAILED|STT_READINESS_GATE_UNAVAILABLE|EGRESS_START_FAILED|EGRESS_NOT_READY|EGRESS_FAILED|EGRESS_ABORTED|EGRESS_LIMIT_REACHED|INSTRUCTOR_NOT_PUBLISHING|START_FAILED`)로 전달한다. 상세: [ADR-0002](decisions/choinhoo/0002-live-start-egress-stt-orchestration.md). **세션 응답은 `lessonId`까지만 준다 — 커리큘럼·섹션·강의 제목은 담지 않는다**(live 모듈은 curriculum을 참조하지 않는다, [decisions/songjeongki/0007](decisions/songjeongki/0007-domain-live-session.md)). 그 맥락이 필요한 화면은 `lessonId`로 **기존 `GET /lessons/{id}`** 를 읽어 채우며(소유 강사도 열리므로 역할 분기가 없다), 없는 값을 빈 문자열로 채우지 않는다([decisions/seominkyeong/0004](decisions/seominkyeong/0004-live-session-curriculum-context.md)). |

### 2-1. 라이브 송출 종료와 세션 대화·학생 HLS 지속

`POST /live-sessions/{sessionId}/end`는 별도 operation 없이 한 요청에서 다음을 순차 수행하고
최종 세션 표현을 **200**으로 반환한다([ADR-0003](decisions/choinhoo/0003-simple-live-end-sequential-process.md)).

```text
LiveSessionStatus: LIVE → ENDING 커밋
→ LiveKit Room 삭제
→ VideoAssetStatus: RECORDING → FINALIZING 커밋
→ egressId가 있으면 StopEgress 중복 안전장치 호출(실패 허용)
→ LiveSessionStatus: ENDING → ENDED 커밋
```

- Room 삭제 실패는 **502 `LIVE_ROOM_CONTROL_FAILED`**이고 세션은 `ENDING`에 남는다. 강사가 같은 요청으로 재시도한다.
- RoomComposite Egress 종료와 서명된 `egress_ended` webhook은 LiveKit·녹화 자산의 후속 생명주기다.
  Room 삭제 뒤 `egressId`가 있으면 `StopEgress`를 중복 안전장치로 호출하되, 성공 여부는 종료 API의
  완료 조건이 아니며 실패해도 세션은 `ENDED`가 된다([ADR-0003](decisions/choinhoo/0003-simple-live-end-sequential-process.md),
  [ADR-0007](decisions/choinhoo/0007-recording-ready-auto-publish-and-processing-polling.md)).
- 채팅 REST·STOMP와 AI SSE 쓰기는 `LIVE`·`ENDING`·`ENDED`에서 허용한다. `ENDED`는 송출 종료
  상태이지 세션 대화 종료 상태가 아니며, 복습 질문과 후속 토론을 계속할 수 있다
  ([ADR-0004](decisions/choinhoo/0004-ended-session-conversation.md)).
- `session.ended`는 강사 송출과 Room 종료만 뜻한다. 학생 UI는 별도 송출 종료 안내 없이 재생 중인
  HLS, 자막 노출·시각 이동, 채팅·AI 질문과 진행 중 AI SSE를 유지한다.
- 새 자막 생성의 terminal 신호는 `caption.stream.completed`다. agent는 남은 audio·STT event와
  마지막 자막을 drain한 뒤 completion을 발행하며, 동일 `(sessionId, sttSessionId)`에는 그 뒤 새
  delta·segment를 생성하지 않는다. 기존 자막은 남은 HLS 위치에 맞춰 계속 사용한다.
- HLS 파일 확정은 `VideoAsset READY/FAILED`, 학생별 실제 재생 완료는 browser player의 `ended`가
  판단한다. 이 drain 정책은 [ADR-0005](decisions/choinhoo/0005-ended-hls-caption-drain.md)에
  확정됐으며 현재 FE 종료 배너·자막 잠금과 backend `ENDED` replay 게이트에는 **코드 반영이 필요하다**.
- 시작 전·취소·실패 상태의 새 대화는 **409 `LIVE_SESSION_STATE_CONFLICT`**다.

### 2-2. `VideoAssetStatus` 상태축

`VideoAssetStatus`는 HLS 파일 생성·검증 상태이며 공개 여부인 `ReplayStatus`
(`DRAFT`·`READY_FOR_REVIEW`·`PUBLISHED`·`WITHDRAWN`)와 의미상 독립이다. 다만 새 정상 녹화의
성공 확정 정책은 학생에게 바로 영상을 열기 위해 두 상태를 같은 트랜잭션에서 `READY + PUBLISHED`로
커밋한다. AI 산출물의 검수·게시 상태는 이 자동 게시에 포함하지 않는다.

| 상태 | 의미와 처리 |
|---|---|
| `STARTING` | Egress 시작 준비·응답 재조정 중. Egress ID가 아직 없을 수 있다 |
| `RECORDING` | Egress ID가 저장됐고 HLS 세그먼트·manifest를 생성 중 |
| `FINALIZING` | 중지 요청 뒤 마지막 세그먼트와 ENDLIST, webhook을 기다리는 상태 |
| `VERIFYING` | 성공 webhook 뒤 스토리지 manifest를 확인하는 상태. 현재는 최종 확정과 같은 트랜잭션이라 일반 조회에서 거의 관찰되지 않는다 |
| `READY` | 최종 manifest가 확인됐거나 검증 장애에서 성공 webhook을 신뢰해 파일을 확정한 상태 |
| `FAILED` | 시작·Egress·manifest 검증 실패. `failureCode`를 기록하며 시작 재시도 시 `STARTING`으로 초기화할 수 있다 |

정상 전이는 `(신규 또는 FAILED) → STARTING → RECORDING → FINALIZING → VERIFYING → READY`다.
종료 요청은 먼저 자산을 `FINALIZING`으로 커밋하고 Egress 중지를 요청한다. `egress_ended`의
`EGRESS_COMPLETE`는 manifest 검증 뒤 `READY`, 실패·중단 또는 manifest 부재는 `FAILED`로 확정한다.
webhook handler는 `READY/FAILED`가 아닌 자산을 멱등 처리하므로 Egress가 조기 종료되면
`STARTING`·`RECORDING`에서도 바로 `VERIFYING → READY/FAILED`로 갈 수 있다.
사용하지 않던 `REQUESTED`는 [ADR-0006](decisions/choinhoo/0006-remove-video-asset-requested-status.md)에
따라 enum·DB 기본값·현재 CHECK 제약에서 제거했다.

### 2-3. 강사 녹화 처리 현황 조회와 자동 이동 — 구현됨

`POST /live-sessions/{sessionId}/end`가 200을 반환하면 강사 FE는 processing 화면으로 이동하고
다음 DB snapshot을 폴링한다([ADR-0059](decisions/songjeongki/0059-live-processing-status-is-two-axes.md),
[ADR-0007](decisions/choinhoo/0007-recording-ready-auto-publish-and-processing-polling.md)).

```http
GET /api/instructor/live-sessions/{sessionId}/processing
```

```json
{
  "sessionId": "20000000-0000-4000-8000-000000000001",
  "liveSessionStatus": "ENDED",
  "recordingEnabled": true,
  "startedAt": "2026-08-02T13:30:00+09:00",
  "endedAt": "2026-08-02T15:00:03+09:00",
  "videoAsset": {
    "videoAssetId": "40000000-0000-4000-8000-000000000001",
    "status": "FINALIZING",
    "replayStatus": "DRAFT",
    "failureCode": null,
    "durationMs": null,
    "sizeBytes": null,
    "recordingStartedAt": "2026-08-02T13:30:04+09:00",
    "recordingEndedAt": "2026-08-02T15:00:03+09:00"
  }
}
```

- **두 상태축을 접지 않는다.** `videoAsset.status`
  (`STARTING|RECORDING|FINALIZING|VERIFYING|READY|FAILED`)와 자산 내부 `replayStatus`
  (`DRAFT|READY_FOR_REVIEW|PUBLISHED|WITHDRAWN`)를 `ready` 같은 단일 값으로 합치지 않는다.
  새 정상 녹화는 성공 webhook의 한 트랜잭션에서 `READY + PUBLISHED`로 확정하지만, 기존 미게시·철회
  자산에는 다른 조합이 남을 수 있다.
- **표시 문구를 담지 않는다.** 서버는 상태만 반환하고 단계 이름·설명은 FE가 만든다.
  응답에 `steps`·`ready`·`label`이 들어오면 계약 위반이다.
- `videoAsset`은 null일 수 있으며 실패를 뜻하지 않는다. `recordingEnabled=true`면 자산 생성을 기다리고,
  `false`면 녹화 비활성 안내 후 폴링을 멈춘다.
- `STARTING/RECORDING/FINALIZING/VERIFYING`은 최초 30초 동안 2초, 이후 5초 간격으로 폴링한다.
  비활성 탭에서는 중단하며 FE timeout을 `FAILED`로 해석하지 않는다.
- `READY + PUBLISHED`면 폴링을 멈추고, 별도 세션 상세에서 얻은 `lessonId`의 강사 replay 경로로
  `replace` 이동한다. `READY + DRAFT/READY_FOR_REVIEW/WITHDRAWN`은 수동 게시 동선을 제공한다.
  `FAILED`는 폴링을 멈추고 `failureCode`를 표시한다.
- 소유 강사는 200, 비소유 사용자·수강생은 403 `LIVE_SESSION_FORBIDDEN`, 없는 세션은
  404 `LIVE_SESSION_NOT_FOUND`다. 조회는 매번 LiveKit·MinIO를 호출하지 않고 DB 상태만 반환한다.

### 2-4. 알림 센터 — **다섯 경로 모두 구현됨, 나머지 발행 지점은 남음**

FE는 타입·Interface·Mock·화면·이동 규칙을 모두 구현했다
([ADR-0012](decisions/seominkyeong/0012-notification-center-two-status-axes.md)).
서버는 **읽기 경로 네 개**(목록·배지·개별 읽음·모두 읽음)를 구현했고
([ADR-0073](decisions/songjeongki/0073-notification-fanout-architecture.md)),
HTTP 어댑터도 그 넷은 실제 호출로 배선됐다.

**발행은 수강 판정까지 붙었다.** 승인 필요 커리큘럼에 신청하면 강사에게 `ENROLLMENT_REQUESTED`
(ACTION_REQUIRED), 승인·거절하면 학생에게 `ENROLLMENT_APPROVED`·`ENROLLMENT_REJECTED`(INFO)가 간다.
경로는 **도메인 이벤트 → 아웃박스(같은 트랜잭션) → `notification.fanout` 큐 → 워커 → 알림 행**이다.
즉시 수강(IMMEDIATE)에는 알림이 없다 — 강사가 처리할 일이 없기 때문이다.

**자료 게시는 넓은 팬아웃이다.** 강사가 자료를 붙이면 그 커리큘럼의 **수강 중(ACTIVE) 학생 전원**에게
`MATERIAL_PUBLISHED`가 간다. 수신자 명단은 앱을 통과하지 않는다 — 조건은 SQL이 걸고, 워커가 커서로
조각을 잘라 자기 다음 조각을 큐에 넣는다(ADR-0073 §5). 임베딩 스위치와 무관하게 발행된다.

**대상 재판정도 붙었다.** 누른 시점에 커리큘럼·강의·라이브·다시보기를 다시 읽어 `AVAILABLE` 또는
`GONE`을 준다. 필요한 권한은 **알림 종류가 정한다** — 신청 알림은 담당 강사, 자료 알림은 수강 중,
거절 알림은 게시 여부만 본다(거절당한 학생은 정의상 수강 중이 아니라, 하나로 뭉개면 그 알림이
자기 자신 때문에 막힌다). `GONE`이면 그 알림의 처리 축을 `EXPIRED`로 내린다 — 갈 곳 없는 항목이
처리 대기 목록에 영원히 남지 않게.

**라이브 일정 세 종류도 넓은 팬아웃이다.** 일정이 잡히면 `LIVE_SCHEDULED`, 시각이 **실제로**
바뀌면 `LIVE_SCHEDULE_CHANGED`(변경 전·후를 함께 저장), 취소되면 `LIVE_CANCELED`가 수강 중 학생
전원에게 간다. 시각 없는 초안·입장창만 수정·같은 시각 재저장·멱등 취소에는 **알림이 없다**.

**녹화는 강사에게, 다시보기는 학생에게 간다.** Egress가 끝나면 강사에게 `RECORDING_READY`,
실패하면 `RECORDING_FAILED`(ERROR)가 간다 — 학생에게 실패를 보내면 할 수 있는 일이 없는데 불안만
준다. 다시보기가 공개되면(자동·수동 모두) 수강 중 학생 전원에게 `VOD_PUBLISHED`가 간다. 철회했다
다시 공개해도 **다시 알리지 않는다** — 그 다시보기가 있다는 것은 이미 알고 있다.

**`LESSON_PUBLISHED`는 발행 지점이 없다.** 레슨에는 초안이 없고 공개 여부는 커리큘럼이 결정하므로
([ADR-0005](decisions/seominkyeong/0005-lesson-has-no-draft-state.md)) "강의가 게시됐다"는 사건 자체가
생기지 않는다. FE 타입·목·문구는 있지만 **서버는 이 종류를 만들지 않는다** — 지우지 않는 이유는
레슨에 공개 상태가 생기면 그때 쓸 자리이기 때문이고, 그전까지는 이 줄이 유일한 설명이다.

**`LIVE_STARTING_SOON`은 시각이 트리거다.** 12종 중 유일하게 아무 사건 없이 시각이 되면 나간다.
발화 예정 표(`core.notification_schedule`)는 **언제 알릴지만** 담고 누구에게는 담지 않는다 — 명단은
발화 시점의 수강 상태가 정한다. 리드타임은 **10분 고정**이며(설정은 후속), 일정이 바뀌면 예정도
따라 옮겨지고 취소되면 사라진다. 배포·장애로 발화가 밀려 시작 시각까지 지나갔으면 **보내지 않는다**
— "곧 시작합니다"가 거짓이 되기 때문이다.

**실시간 전달은 STOMP 개인 목적지로 간다.** 새 알림이 생기면 `/user/queue/notifications`로 **신호만**
간다 — 내용이 아니라 "왔다"는 사실이고, 화면은 그걸 받으면 목록·개수를 다시 읽는다. 내용을 싣지
않는 이유는 넓은 팬아웃이 집합 삽입이라 앱에 행 데이터가 없고, 알림 모양이 REST와 WS 두 곳에
생기면 한쪽만 고치는 어긋남이 자라기 때문이다. `/user` 접두사를 Spring이 세션 주체로 해석하므로
**남의 알림을 구독할 방법이 없다**(토픽과 달리 구독 인가 목록을 늘리지 않는다). 접속해 있지 않으면
보내지 않고, 알림은 알림함에 쌓여 있다가 다음에 열 때 보인다.

**60초 폴링은 그대로 둔다.** 연결이 끊긴 동안 온 알림은 신호가 오지 않으므로, 폴링이 없으면 다시
연결될 때까지 배지가 멈춘다. 실시간은 그 사이를 좁힐 뿐이다.

**Web Push는 탭을 닫아도 온다.** 표준 Web Push라 **벤더 계정 등록이 필요 없다** — VAPID 키쌍은
우리가 만들고, 푸시 서비스는 그 서명으로 "같은 서버가 보냈다"만 확인한다(2016년까지 필요하던 FCM
발신자 ID를 대체했다). 페이로드는 구독의 `p256dh`·`auth`로 암호화되어 **푸시 서비스도 내용을 보지
못한다**.

| 목적 | Method·URL | 비고 |
|---|---|---|
| VAPID 공개키 | `GET /api/me/push-subscriptions/public-key` | 미설정이면 `null`(404 아님) |
| 구독 등록 | `POST /api/me/push-subscriptions` | 멱등. 같은 엔드포인트면 갱신하고 **주인을 바꾼다** |
| 구독 해제 | `DELETE /api/me/push-subscriptions` | 본인 것만. 없어도 성공 |

기기당 한 행이라 PC에서 읽어도 폰 알림은 사라지지 않는다. 푸시 서비스가 404·410을 주면 그 구독을
**즉시 지운다** — 남겨 두면 발송의 대부분이 죽은 구독을 두드리는 일이 된다. VAPID 키가 없으면
푸시는 **꺼진 채로** 동작한다(알림함·STOMP는 그대로).

**브라우저 권한 요청은 사이트 안내를 거친 뒤에만 연다(FE, [ADR-0022](decisions/yoongwanghyeok/0022-browser-push-permission-ux-policy.md)).**
로그인·Web Push 지원·권한 `default`·활성 구독 없음·알림 받을 가치가 있는 강의 있음, 다섯 조건이
모두 맞을 때만 대시보드가 사이트 자체 안내를 한 번 띄우고, **"브라우저 알림 켜기"를 누른 순간에만**
`Notification.requestPermission()`을 부른다. "나중에"는 이 브라우저에서 7일간 다시 띄우지 않는다
(localStorage에 닫은 시각만 남기고 브라우저 지문은 만들지 않는다). 네이티브 권한창에서 거절했으면
`Notification.permission`이 `denied`로 이미 막으므로 사이트가 다시 묻지 않는다.
영구 설정은 **전체 알림 페이지 헤더 우측의 압축 토글**이 전담한다(켜짐·꺼짐·차단됨·지원하지
않음). 지원하지 않으면 토글은 그대로 두고 회색으로 비활성화한다(레이아웃이 페이지마다 흔들리지
않게). 차단됐으면 스위치 대신 "브라우저 알림 차단됨" 문구를 두고, 그 문구를 누르면 차단 해제
방법을 안내하는 팝오버가 열린다(스크립트로는 재요청이 막혀 있어 안내만 가능하다). 큰 카드로
상태를 풀어 설명하지 않는 이유는 페이지 진입마다 반복해서 읽을 문구가 아니기 때문이다. 여기서
끄는 것은 **브라우저 권한이 아니라 이 기기의 구독**이다. 헤더 알림 팝업에는 브라우저 알림
제어를 두지 않는다(전체 알림 보기로만 이어 준다). 계정을 바꾸면 같은
브라우저의 기존 구독을 새 로그인 계정 앞으로 다시 등록하고, **명시적으로 로그아웃하면 그 즉시
서버 쪽 구독 소유자만 지운다**(브라우저 구독 자체는 남겨 다음 로그인이 이어받는다).

**리드타임은 커리큘럼 단위로 정하고 강의별로 덮어쓴다.** 선택지는 5·10·30·60·180·1440분이고,
설정 이력이 없으면 **미리 알림 받기 켜짐·10분 전**이 적용되며 끄기가 가능하다. **자유 입력이 아닌
이유**는 예약 표가 선택지에 맞춰 미리
만들어져 있기 때문이다 — 임의 값을 받으면 그 값의 발화 행이 없어 그 사람에게는 알림이 영영 가지
않는다(설정은 저장됐는데 알림만 안 오는, 가장 알아채기 어려운 고장이다).

| 목적 | Method·URL | 비고 |
|---|---|---|
| 선택지 | `GET /api/me/notification-preferences/lead-times` | 값과 기본값 |
| 지금 적용값 | `GET /api/me/notification-preferences?curriculumId=&lessonId=` | `source`로 LESSON·CURRICULUM·DEFAULT 구분 |
| 저장 | `PUT /api/me/notification-preferences` | `lessonId` 있으면 그 강의만 덮어쓴다 |

우선순위는 **강의 → 커리큘럼 → 기본값**이고 **끄기도 덮어쓰기의 일부**다 — 커리큘럼을 꺼 두고
특정 강의만 켤 수 있다. `enabled`를 따로 두는 이유는 "설정한 적 없음"과 "꺼 뒀음"을 구별하기
위해서다(끄기를 `leadMinutes = null`로 표현하면 기본값이 바뀌는 날 꺼 둔 사람에게 알림이
되살아난다). 강사·학생을 가르지 않는다 — 강사가 학생으로 수강할 때 설정이 갈라지면 안 된다.

설정 UI는 **커리큘럼 상세**와 **강의 상세**에 팝오버로 둔다. 커리큘럼 상세에서는 공개 상태 배지
왼쪽의 알림 버튼으로 전체 값을 바꾸며, **수강 중이거나 소유 강사일 때만** 버튼이 보인다. 강의
상세에서는 첫 번째 강의 정보 카드의 알림 버튼으로 그 강의만 덮어쓴다. 적용값이 꺼져 있으면 두
화면 모두 대각선이 그어진 종 아이콘을 표시한다.

**알림 센터는 여기까지다.** FE 어댑터는 더 이상 501을 던지지 않는다.

| 목적 | Method·URL | 응답 | 권한 | 상태 |
|---|---|---|---|---|
| 배지 개수 | `GET /api/me/notifications/summary` | `{ unreadCount, actionRequiredCount }` | 로그인 필요(401) | 구현됨 |
| 목록 | `GET /api/me/notifications?scope=ALL\|ACTION_REQUIRED&readState=UNREAD\|READ&page=&size=` | 아래 페이지 응답 | 본인 것만 | 구현됨 |
| 개별 읽음 | `POST /api/me/notifications/{id}/read` | 갱신된 알림 1건 | 남의 알림은 **404**(403 아님) | 구현됨 |
| 모두 읽음 | `POST /api/me/notifications/read-all` | `{ unreadCount: 0, actionRequiredCount }` | 본인 것만 | 구현됨 |
| 클릭 대상 재판정 | `GET /api/me/notifications/{id}/target` | `AVAILABLE` + 상태 또는 `GONE` + 이유 | 본인 것만 | 구현됨 |

```json
{
  "items": [
    {
      "notificationId": "ntf_0001",
      "recipientId": "usr_instructor_01",
      "type": "ENROLLMENT_REQUESTED",
      "readStatus": "UNREAD",
      "actionStatus": "ACTION_REQUIRED",
      "severity": "NORMAL",
      "title": "새로운 수강 신청이 있습니다.",
      "message": "김민수 님이 ‘React 실시간 클래스’ 수강을 신청했습니다.",
      "targets": {
        "curriculumId": "cur_0001",
        "enrollmentId": "enr_0001",
        "studentId": "usr_student_01",
        "actorId": "usr_student_01"
      },
      "groupKey": "ENROLLMENT_REQUESTED:cur_0001",
      "createdAt": "2026-08-02T09:31:00+09:00",
      "readAt": null,
      "completedAt": null,
      "scheduleChange": null
    }
  ],
  "page": 0, "size": 10, "totalElements": 23, "totalPages": 3, "hasNext": true,
  "unreadCount": 8, "actionRequiredCount": 3
}
```

- **`readStatus`와 `actionStatus`를 하나로 합치지 않는다.** `readStatus`(`UNREAD|READ`)는 "봤는가",
  `actionStatus`(`INFO|ACTION_REQUIRED|COMPLETED|EXPIRED`)는 "처리했는가"다. 읽음 처리는 처리 축을
  **절대** 건드리지 않는다 — 강사가 수강 신청 알림을 읽어도 승인·거절 전까지 `ACTION_REQUIRED`다.
  §2-2의 두 상태축 원칙과 같은 이유다.
- **`type`은 12개 고정 union**: `ENROLLMENT_REQUESTED`·`ENROLLMENT_APPROVED`·`ENROLLMENT_REJECTED`·
  `LIVE_SCHEDULED`·`LIVE_STARTING_SOON`·`LIVE_SCHEDULE_CHANGED`·`LIVE_CANCELED`·`LESSON_PUBLISHED`·
  `MATERIAL_PUBLISHED`·`RECORDING_READY`·`RECORDING_FAILED`·`VOD_PUBLISHED`. 임의 문자열 금지.
- **프론트 라우트 URL을 담지 않는다.** 목적지는 `type` + `targets`의 리소스 id + 클릭 시점의 리소스
  상태로 FE(`notificationRouting`)가 계산한다. 응답에 `link`·`url`·`screen`이 들어오면 계약 위반이다.
- **필터는 두 축을 따로 받고 AND로 겹친다.** `scope`(업무 처리 축)와 `readState`(읽음 축)를
  `filter=ALL|UNREAD|ACTION_REQUIRED` 같은 하나의 enum으로 묶지 않는다 — 묶으면 "처리 대기 중 아직
  안 읽은 것"을 물어볼 수 없다. 각각 생략하면 그 축으로 가리지 않는다. `readState`가 불린이 아닌
  이유는 화면이 `읽지 않음`·`읽음`을 나란한 탭으로 나눠 "읽은 것만" 보는 상태가 따로 있기 때문이다.
  화면에서 `scope`는 1차 탭, `readState`는 2차 탭이다.
- **개수는 필터와 무관한 전체 기준**이다. `readState=UNREAD`로 걸러도 `unreadCount`는 전체 미읽음 수다.
- **중복 방지는 서버 책임.** `(type, recipientId, 관련 리소스 id)` 멱등 키로 같은 사건이 재시도돼도
  (Egress webhook 재전송 등) 한 건만 남긴다. 이 키는 응답에 노출하지 않는다. `groupKey`는 향후
  묶음 표시("수강 신청 3건")를 위한 값이며 지금은 FE가 표시에 쓰지 않는다.
- **목록은 반드시 페이지네이션**한다. 무제한 응답을 주지 않는다(드롭다운 `size=5`, 알림 페이지 `size=8`).
- **대상 재판정은 생성 시점 권한을 믿지 않는다.** `GET .../target`은
  `{ "status": "AVAILABLE", "state": { curriculumId, sectionId, lessonId, liveSessionId, enrollmentId,
  studentId, liveSessionStatus, scheduledAt, replayStatus } }` 또는
  `{ "status": "GONE", "reasonCode": "TARGET_DELETED|ACCESS_REVOKED|TARGET_EXPIRED" }`를 준다.
  `GONE`은 **오류가 아니라 정상 200 응답**이다 — 404로 주면 FE가 서버 장애와 구별할 수 없다.
  `GONE`일 때 서버는 해당 알림의 `actionStatus`를 `EXPIRED`로 내린다.
- **수신자 판정**: 수강 신청 알림은 해당 커리큘럼의 실제 담당 강사에게만, 라이브·강의·자료·다시보기
  알림은 `EnrollmentStatus=ACTIVE`인 학생에게만. 강사 계정이라는 이유만으로 남의 커리큘럼 알림을
  받지 않는다. `PENDING`·`REJECTED`·`REVOKED`·`CANCELLED`는 수신 대상이 아니다.
- **BE 후속 작업**: ~~(1) 알림 테이블(멱등 키 unique 제약 포함)과 조회 4개 엔드포인트~~ — 완료
  (`V23__notification.sql`의 `dedupe_key` UNIQUE + `NotificationController`),
  (2) ~~수강 판정~~ 완료(`CurriculumEnrollmentService` → `EnrollmentRequestedEvent`·`EnrollmentDecidedEvent`).
  ~~자료 게시~~ 완료(`InstructorCurriculumService` → `CurriculumMaterialPublishedEvent`, 넓은 팬아웃).
  ~~라이브 일정~~ 완료(`LiveSessionService` → `LiveScheduleEvent`).
  ~~Egress 완료·다시보기 게시~~ 완료(`RecordingService`·`ReplayPublicationService`), ~~`/target`~~ 완료,
  (3) `LIVE_STARTING_SOON`·오늘의 라이브 일정 알림을 만드는 예약 작업(현재 `@Scheduled`는
  `LiveStartReconciler`·`AssetReaper`·`OutboxRelay`에만 있어 알림용 잡이 없다),
  (4) 실시간 push(WS/SSE) — 없는 동안 FE는 60초 주기로 `summary`를 폴링한다.
  구현이 끝난 뒤의 설계·트레이드오프·트러블슈팅 기록은
  [NOTIFICATION-CENTER.md](NOTIFICATION-CENTER.md)에 있다(규격은 이 절이 정본이며 그 문서는
  복제하지 않는다). 착수 전 인수 문서였던 `NOTIFICATION-BACKEND-HANDOFF.md`는 역할이 끝났다.

## 3. 내부 계약 (확정 인터페이스)

### 3-1. Spring → AI 배치 잡 (RabbitMQ)
자료 임베딩 잡 envelope(정본은 코드 `InstructorCurriculumService`): 레슨 스코프는 `{ taskType, materialId, assetId, lessonId, curriculumId, fileName, policy{embedModel}, contractVersion }`. taskType: `PPTX_EMBED`(자료 임베딩)·`EMBED_DELETE`(자료 삭제 시 chunk 제거) 등. **커리큘럼 스코프(ADR-0042)**: 레슨이 없으므로 `lessonId` 대신 `scope: "CURRICULUM"`을 싣고 `curriculumId`만 준다(레슨 잡은 `scope` 미포함 = 암묵적 `LESSON`). 워커는 `scope`로 RAG 적재 범위를 정한다 — 이 계약 진화(스코프별 필수 필드)를 소비하는 워커 측 배선은 후속(ai-worker `PptxEmbedJob`의 `lessonId` optional화 필요, `material.embedding.enabled` 기본 off라 미배선 상태에서 무회귀). (라이브 STT는 배치 아님 — Redis Streams §3-4. 트랜스코드는 없음 — VOD=Egress 녹화, [decisions/songjeongki/0010](decisions/songjeongki/0010-self-host-vod.md)) **outbox**로 발행 신뢰성, 실패는 **DLQ**. **워커 파일 접근(B안, 주문형 발급)**: envelope에 파일 위치·URL을 싣지 않는다. 워커가 잡 처리 **직전에** `POST /api/internal/ai/materials/download-url`(본문 `{assetId}`, §3-2와 동일 HMAC 서명)로 갓 서명된 presigned GET URL을 받아 스토리지에서 직접 읽는다 — 자격증명을 워커에 두지 않고, 사용 직전 발급이라 TTL 만료와 무관. chunk 정책(chunkSize·overlap)은 워커 설정 소유(envelope의 `policy`는 `embedModel`만). 상세: [decisions/songjeongki/0036](decisions/songjeongki/0036-material-embedding-pipeline.md).

**강조 판서 잡(ADR-0074) — AI 수용 구현됨, Spring producer 미구현**: 같은 `ingestion.embed` 큐·같은 봉투 규약을 쓰며 `taskType`으로만 구분한다. `ANNOTATION_EMBED` = `{ taskType, highlightId, sessionId, lessonId, curriculumId, sessionMs, capturedAt, text, policy{embedModel}, contractVersion }`, `ANNOTATION_EMBED_DELETE` = `{ taskType, highlightId, contractVersion }`. **이미지는 AI로 넘어오지 않는다** — Spring이 강조 크롭을 자기 vision 모델로 읽어 `text`를 만들고, AI는 그것을 검증 없이 색인한다(강사 확인이 유일한 게이트). `curriculumId`가 검색 스코프, `sessionMs`가 다시보기 타임라인 앵커, `highlightId`가 멱등 키다. `text`는 필수이며 공백뿐이면 fail-closed 거부다. 길이 상한은 없다 — Spring이 vision 출력을 무제한 컬럼에 담으므로 여기서 자르면 콜백 없이 DLQ로 가고 강사가 PROCESSING에 멈춘다. 64 KiB 봉투가 실질 한계이고 임베딩 입력만 bge-m3 계약에 맞춰 자른다. `capturedAt`은 offset 있는 timestamp여야 한다. 상세: [decisions/songjeongki/0074](decisions/songjeongki/0074-annotation-highlight-evidence-contract.md)·[decisions/canola/0043](decisions/canola/0043-annotation-timeline-evidence-mvp.md).

### 3-2. AI → Spring callback (HTTP, 서명) — 구현됨
`POST /api/internal/ai/callbacks` — permitAll이되 **HMAC-SHA256 서명이 실질 인증**이다(egress webhook 0034와 동일 패턴). 워커가 공유 시크릿(`ai.callback-secret`)으로 **원시 바이트 body**를 서명해 `X-Signature`(base64) 헤더에 실어 보내고, 검증 실패는 401. body: `{ eventId, eventType, jobId, materialId, lessonId, status }`(미지의 필드는 무시). Spring은 `external_event_inbox`에 `(source=ai-worker, eventId)` 복합키로 삽입해 **멱등** 처리(중복이면 무시). eventType → 자료 임베딩 상태 매핑: `MATERIAL_EMBEDDED`→READY, `MATERIAL_EMBED_FAILED`→FAILED, `MATERIAL_EMBEDDING`→PROCESSING, 그 외는 inbox에만 남기고 상태 불변. 코드: `aiintegration/service/AiCallbackService.java`·`web/AiCallbackVerifier.java`. 상세: [decisions/songjeongki/0036](decisions/songjeongki/0036-material-embedding-pipeline.md).

**강조 판서 callback(ADR-0074) — AI 발신 구현됨, Spring 매핑 미구현**: 같은 endpoint·같은 HMAC·같은 `eventId` 멱등 규약을 쓰되 body가 `{ eventId, eventType, jobId, highlightId, status }`다(`materialId`·`lessonId` 없음 — Spring은 `highlightId`만으로 `core.annotation_highlight.index_status`를 확정한다). eventType: `ANNOTATION_EMBEDDED`→READY, `ANNOTATION_EMBED_FAILED`→FAILED, `ANNOTATION_EMBEDDING`→PROCESSING. 자료 callback과 같은 이유로 워커는 terminal 두 종류만 발신한다. Spring이 아직 매핑하지 않아 현재는 inbox에만 남는다. **`ANNOTATION_EMBED_DELETE`에는 callback이 없다** — 정의된 eventType 3종이 모두 색인용이라 삭제 성공을 알릴 값이 없고, READY를 재사용하면 삭제된 강조를 "색인됨"으로 잘못 알린다. 삭제 결과 확인이 필요하면 오너 합의로 eventType을 먼저 추가한다.

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

### 3-4a. ai-api → application Redis 실시간 강의 노트 Stream — AI producer 구현, Spring 저장·조회·전파 구현·consumer 미구현

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

Spring의 **저장·조회·전파는 구현됐고 consumer만 남았다**([ADR-0061](decisions/songjeongki/0061-lecture-note-read-model-is-producer-agnostic.md)).
`core.live_lecture_note`가 세션당 한 행으로 **현재 전체 노트**를 들고 있고,
`GET /api/live-sessions/{sessionId}/notes`와 `/topic/live-sessions/{sessionId}/notes`의
`lecture.note.updated`가 **같은 모양**(`{coveredThroughSequence, topics, markdown, status, updatedAt}`)을 준다 —
조각 이어 붙이기는 서버가 한 번만 하고 화면은 마지막 것만 들면 된다. `topics`는 서버가 해석하지 않는
JSON 문자열이며, `coveredThroughSequence`가 지금 값보다 크지 않은 갱신은 무시한다(재전송·순서 역전 방어).
구독 인가는 자막·채팅과 같은 게이트이고 허용목록에 `notes` 하나가 더해졌다(ADR-0019 와일드카드 차단 불변식 유지).
남은 것은 Redis Stream을 읽어 이 read model을 갱신하는 consumer 하나뿐이다. AI producer는 caption과 미처리 작업을
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
- **자막 채널** `/topic/live-sessions/{sessionId}/captions`(세션별, 구독 인가는 채팅과 동일 게이트·와일드카드 차단 불변식 ADR-0019·0043): `WsEnvelope.of(type, sessionId, occurredAt, payload)`로 push. `type`은 `caption.delta`·`caption.stream.completed`. payload는 camelCase — delta `{ sttSessionId, sequence, streamElapsedMs, sessionMs, text }`, completed `{ sttSessionId, lastSequence, sessionMs, reason }`. `caption.stream.completed`는 해당 `(sessionId,sttSessionId)`의 terminal event이며 `lastSequence` 뒤 새 자막을 생성·반영하지 않는다. 기존 자막은 HLS 잔여 재생 동안 유지한다([ADR-0005](decisions/choinhoo/0005-ended-hls-caption-drain.md)).
- **채팅 채널** `/topic/live-sessions/{sessionId}/chat`: `chat_message { lessonId, sessionMs, text, alias }`(실명·userId 미노출).
- **강의 노트 채널** `/topic/live-sessions/{sessionId}/notes`(§3-4a): `lecture.note.updated` payload
  `{coveredThroughSequence, topics, markdown, status, updatedAt}`. **증분이 아니라 늘 전체**이며 조회
  응답과 같은 모양이다. 구독 인가는 자막·채팅과 동일 게이트.
- **세션 상태 채널** `/topic/live-sessions/{sessionId}/state`([ADR-0003](decisions/choinhoo/0003-simple-live-end-sequential-process.md)):
  `session.ending` payload `{liveSessionStatus:"ENDING",endedAt:null}`와
  `session.ended` payload `{liveSessionStatus:"ENDED",endedAt:"..."}`를 각 DB 전이의 **커밋 후** push한다.
  `session.ending`은 종료 진행 상태이고 상호작용을 잠그지 않는다. `session.ended`도 강사 송출·Room
  종료 신호일 뿐 학생 HLS·자막·대화 잠금 신호가 아니다. 학생에게 별도 송출 종료 안내를 표시하지 않는다.
  재연결 뒤 FE는 `GET /live-sessions/{sessionId}`를 다시 조회해 이벤트 유실을 보완한다.
  같은 채널로 **`session.presence`** payload `{participantCount}`도 push한다([ADR-0060](decisions/songjeongki/0060-live-presence-counts-subscriptions.md))
  — 지금 강의실에 있는 **수강생 수**이며 **강사는 세지 않는다**(혼자일 때 1이 되면 오해를 만든다).
  수강생은 LiveKit 방에 들어오지 않으므로(ADR-0032) 방 참여자 목록으로는 청중을 셀 수 없다. 서버는 이 채널의
  **구독을 사람 단위로**(한 사람이 탭을 여러 개 열어도 1) 센다. **초기값은 이 채널이 아니라 `GET /live-sessions/{id}`의
  `participantCount`로 준다** — 구독 인가는 브로커가 구독을 등록하기 전에 지나가므로 그때 보낸 브로드캐스트는
  방금 들어온 본인에게 닿지 않는다. 이 이벤트는 **이미 있던 사람들에게** 증감을 알리는 용도다.
  FE는 이 이벤트를 세션 상태 전이와 **섞지 않는다**
  (`liveSessionStatus`를 건드리지 않는다). 단일 인스턴스 전제이며(SimpleBroker와 동일 전제, ADR-0019)
  다중 인스턴스에서는 외부 relay 전환과 함께 공유 저장소로 옮겨야 한다.
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
  - **op가 아니다.** 별도 테이블(`core.live_annotation_highlight`, 세션당 한 행)에 둔다. op 테이블에 넣으면 `(session_id, revision)` UNIQUE에 걸리거나, 새 번호를 소비해 **수신 측에 번호 구멍**이 생겨 그 뒤 op가 전부 버려진다.
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
- **모델에 이미지를 <b>본문으로 싣지 않는다</b>**([ADR-0058](decisions/songjeongki/0058-annotation-interpret-image-by-url.md)). 서버가 `GET /api/annotation-interpret-images/{token}`(공개, 인증 없음)로 잠깐 노출하고 그 URL을 모델에 준다. 게이트웨이 본문 한도(실측 ~100KB)를 넘으면 본문을 읽지 못하고 `"Model not found in request"`라는 크기와 무관해 보이는 오류가 오므로, 판서를 크게 그릴수록 해석이 실패했다.
  - 받아가는 쪽이 <b>모델 제공자의 서버</b>라 우리 인증 주체가 아니다. 토큰이 곧 자격이므로 **128비트 난수 · TTL 2분 · 호출 종료 시 즉시 폐기**로 노출 창을 좁힌다.
  - 브라우저는 이 경로를 쓰지 않는다. FE는 지금처럼 data URI를 서버에 보내고, URL로 바꾸는 것은 서버가 한다.

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

### 3-10. Spring ↔ media-worker MP4→HLS — 구현됨

- Spring은 durable RabbitMQ queue `media.transcode`에 다음 camelCase JSON을 발행한다.

```json
{
  "taskType": "MP4_TO_HLS",
  "jobId": "uuid",
  "recordedVideoId": "uuid",
  "lessonId": "uuid",
  "sourceAssetId": "uuid",
  "outputPrefix": "recorded/{recordedVideoId}",
  "contractVersion": 1
}
```

- worker는 `POST /api/internal/media/transcode-jobs/{jobId}/source-url`로 짧은 원본 GET URL을 받고,
  `POST /api/internal/media/transcode-callbacks`로 `RUNNING|SUCCEEDED|FAILED`를 통지한다. 두 요청은
  각각 별도 HMAC-SHA256 secret을 쓰며 raw body 서명을 `X-Signature` Base64로 보낸다.
- 성공 callback은 `{eventId,jobId,recordedVideoId,status:"SUCCEEDED",output:{bucket,hlsManifestKey,durationMs,sizeBytes,segmentCount},failureCode:null}`다.
  실패 callback은 안정 `failureCode`를 포함한다. Spring은 `(source="media-worker",eventId)` inbox로
  멱등 처리하고, 서버 지정 `recorded/{recordedVideoId}/index.m3u8`, `#EXT-X-ENDLIST`, 첫 segment 존재를
  검증한 뒤에만 `READY`로 전이한다. Queue DLQ는 `media.transcode.dlq`다.

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
