# CONTRACT.md — 공유 계약 (정본)

> 📍 하네스 개요: [docs/harness/README.md](harness/README.md) · 정본 규칙: [AGENTS.md](../AGENTS.md) · 아키텍처: [ARCHITECTURE.md](ARCHITECTURE.md)
>
> **FE↔Spring**, **Spring↔AI(RabbitMQ/HTTP)**, **AI→Spring(Redis Streams/callback)** 이 동시에 지켜야 어긋나지 않는 계약. 한쪽이 바꾸면 다른 쪽이 깨지는 항목만.
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
| 커리큘럼(강사) | `POST/PATCH /instructor/curriculums`·`.../sections`·`.../curriculum/order` | 소유권 검증 |
| 강의 | `POST /instructor/sections/{id}/lessons`·`PATCH /instructor/lessons/{id}`·`GET /lessons/{id}` | 상태 필드는 **어디서나 `status`**(목차·관리 응답 동일, `lessonStatus` 아님). 값: DRAFT/AI_NOT_READY/READY/PUBLISHED. 수강생용 `GET /lessons/{id}`는 소유권이 아니라 **수강 관계**로 연다 — 미수강 403 `ENROLLMENT_REQUIRED`, 수강 중이라도 미게시 레슨은 404([decisions/songjeongki/0029](decisions/songjeongki/0029-lesson-detail-and-display-name.md)) |
| 자료 | `POST /instructor/lessons/{id}/materials` (PPTX) | presigned→MinIO. **영상 업로드 없음**. 자료를 커리큘럼·레슨에 연결하는 API는 아직 없어 상세의 `materials`는 항상 빈 목록 |
| 에셋 | `POST /assets/upload-requests` → presigned `PUT` → `POST /assets/{id}/complete` | 바이트는 앱 서버를 통과하지 않는다. 받은 `assetId`를 도메인 요청에 실어 보낸다(커리큘럼 `thumbnailAssetId`, 프로필 `assetId`). kind는 **PROFILE_IMAGE·THUMBNAIL만 발급**되고 **MATERIAL은 현재 400으로 거부**된다 ([decisions/songjeongki/0023](decisions/songjeongki/0023-asset-presigned-upload.md)) |
| 다시보기 | `GET /lessons/{id}/playback` | 녹화(Egress) HLS URL 발급(재생 인증 seam). 재생 API는 미구현이나 **녹화본 자체는 생성된다** — 카탈로그의 `replayStatus`는 녹화 없음이면 NOT_READY, 있으면 저장된 상태(현재 DRAFT). 게시 검수 흐름이 없어 PUBLISHED에는 도달하지 않는다. `durationMs`는 녹화 완료 webhook 전까지 null |
| 학습 | `GET /lessons/{id}/learning-context`·`PUT /lessons/{id}/progress`·`POST .../bookmarks` | **구현됨**(learning 배선, [decisions/songjeongki/0032](decisions/songjeongki/0032-learning-progress-wiring.md)). 수강자만(미수강 403 `ENROLLMENT_REQUIRED`, 없는 레슨 404). 진도율은 **클라이언트 계산·서버 저장**(0~100), 90% 넘으면 완료(sticky), `clientUpdatedAt`으로 순서역전 방어. 북마크는 멱등. **카탈로그 `progress`는 이제 활성 수강자에게 채워진다**(완료 레슨 수 기준, 상세·내 수강 목록). watched_ranges 정교화는 후속 |
| 내 수강 | `GET /me/enrollments` | **항목마다 커리큘럼 카드 동봉(구현됨)** — 목록을 받고 커리큘럼을 건건이 다시 조회하지 않도록. 소유 모듈은 curriculum |
| 자막/용어 | `GET /lessons/{id}/transcript`·`/glossary` | 게시본(core) |
| AI | `POST /lessons/{id}/ai/questions:stream`(SSE)·`/ai/terms:explain` | Spring이 권한·정책 후 ai-api 중계 |
| 퀴즈 | `GET /lessons/{id}/quizzes`·`POST /quizzes/{id}/attempts` | 결정론 채점 |
| 채팅 | `GET/POST /live-sessions/{sessionId}/messages` | **세션 키잉(구현됨)**, 본문도 세션 기준. 가명, WS 실시간 + REST 보완 |
| 라이브 | `POST /live-sessions/{id}/start`·`/token`·`/end` | 시작(토큰+Egress 녹화 시작)·LiveKit 토큰(publish/subscribe)·종료 |

## 3. 내부 계약 (확정 인터페이스)

### 3-1. Spring → AI 배치 잡 (RabbitMQ)
잡 envelope: `{ jobId, idempotencyKey, tenantId, curriculumId, lessonId, taskType, inputRefs, policy, contractVersion, correlationId }`. taskType: `PPTX_PARSE|EMBED|CANDIDATE_GEN|STT_2PASS`. (라이브 STT는 배치 아님 — Redis Streams §3-3. 트랜스코드는 없음 — VOD=Egress 녹화, [decisions/songjeongki/0010](decisions/songjeongki/0010-self-host-vod.md)) **outbox**로 발행 신뢰성, 실패는 **DLQ**.

### 3-2. AI → Spring callback (HTTP, 서명)
`{ eventId, eventType, jobId, lessonId, status, outputs }`. eventType 예: `LESSON_AI_READY`. Spring은 `eventId`로 중복 제거(멱등), 산출물을 ai schema에 두고 강사 게시 시 core로 반영.

### 3-3. AI → Spring 실시간 (Redis Streams, STT/자막)
세션별 스트림. 메시지: `caption.partial|final|revised { sessionId|lessonId, segmentId, startMs, endMs, text, revision }` · `term` · `evidence` · `summary`. (라이브 STT 실시간 전달; 다시보기는 저장본 재생 — [decisions/songjeongki/0013](decisions/songjeongki/0013-unified-streaming-stt.md))

### 3-4. FE ↔ Spring WebSocket
- **자막 채널**(세션/강의별): caption 이벤트 push.
- **채팅 채널**: `chat_message { lessonId, userId, sessionMs, text, alias }`.
- 시간은 전부 **세션 상대 ms**.

## 4. 스키마 소유권 (공동수정 금지)
- `core` = Spring 단독 쓰기, `ai` = Python 단독 쓰기. AI 후보(ai)→강사 게시→core read model. 상세: [ARCHITECTURE.md](ARCHITECTURE.md) 도메인 모델.

## 5. 기능 ↔ 오너 맵 (CP 기준)
| CP | 영역 | 오너 | 계약 |
|---|---|---|---|
| CP0 | 인증·강좌·live_session | _미정_ | §2 |
| CP1 | 라이브 미디어(LiveKit·채팅) | _미정_ | §2 라이브, §3-4 |
| CP2 | 라이브 자막(STT) | _미정_ | §3-3 |
| CP3 | 용어·RAG | _미정_ | §2 AI, §3-1, §3-2 |
| CP4 | 녹화·다시보기(Egress) | _미정_ | §2 다시보기, §3-1 |
| CP5 | 퀴즈·따라잡기 | _미정_ | §2 |

## 6. 계약 변경 절차
1. 변경 전 오너 합의 → 확정은 [decisions/](decisions/)에 ADR.
2. 걸린 양쪽(FE·BE 또는 Spring·AI)을 함께 수정.
3. 이 문서·관련 계약 테스트 갱신. MR 체크리스트 계약 항목 체크.
