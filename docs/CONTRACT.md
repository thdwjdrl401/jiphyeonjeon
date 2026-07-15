# CONTRACT.md — 공유 계약 (정본)

> 📍 하네스 개요: [docs/harness/README.md](harness/README.md) · 정본 규칙: [AGENTS.md](../AGENTS.md) · 아키텍처: [ARCHITECTURE.md](ARCHITECTURE.md)
>
> **FE↔Spring**, **Spring↔AI(RabbitMQ/HTTP)**, **AI→Spring(Redis Streams/callback)** 이 동시에 지켜야 어긋나지 않는 계약. 한쪽이 바꾸면 다른 쪽이 깨지는 항목만.
> (구 화상회의 명세 [SPEC.md](legacy/SPEC.md)는 참고용 — [decisions/0003](decisions/0003-greenfield-redesign.md))

---

## 1. 필드명 규칙 — camelCase 통일
> 근거: [decisions/0001](decisions/0001-field-name-camelcase.md) (팀 자체 컨벤션)
- **API JSON·이벤트 필드명은 `camelCase`**. 예: `courseId`·`lessonId`·`sectionId`·`startMs`·`hlsManifestKey`·`isPublished`.
- **DB 컬럼은 snake_case 허용**, DTO/응답/이벤트로 노출되는 순간 camelCase.

## 2. REST API (`/api/v1`, Spring 소유)
| 도메인 | 예시 | 비고 |
|---|---|---|
| 인증 | `POST /auth/login`·`/auth/signup`·`/auth/logout` | 상태코드: 생성 201·중복 409·인증실패 401·권한 403. **HttpOnly 쿠키 세션(Redis 저장)** — FE는 `withCredentials`, `Authorization: Bearer` 미사용. 변경요청 CSRF 토큰([decisions/0014](decisions/0014-auth-redis-session-cookie.md)) |
| 카탈로그 | `GET /courses`·`GET /courses/{id}` | 검색·필터·페이지네이션 |
| 강좌(강사) | `POST/PATCH /instructor/courses`·`.../sections`·`.../curriculum/order` | 소유권 검증 |
| 강의 | `POST /instructor/sections/{id}/lessons`·`PATCH /instructor/lessons/{id}` | status: DRAFT/AI_NOT_READY/READY/PUBLISHED |
| 자료 | `POST /instructor/lessons/{id}/materials` (PPTX) | presigned→MinIO. **영상 업로드 없음** |
| 다시보기 | `GET /lessons/{id}/playback` | 녹화(Egress) HLS URL 발급(재생 인증 seam) |
| 학습 | `GET /lessons/{id}/learning-context`·`PUT /lessons/{id}/progress`·`POST .../bookmarks` | |
| 자막/용어 | `GET /lessons/{id}/transcript`·`/glossary` | 게시본(core) |
| AI | `POST /lessons/{id}/ai/questions:stream`(SSE)·`/ai/terms:explain` | Spring이 권한·정책 후 ai-api 중계 |
| 퀴즈 | `GET /lessons/{id}/quizzes`·`POST /quizzes/{id}/attempts` | 결정론 채점 |
| 채팅 | `GET/POST /lessons/{id}/messages` | 가명, WS 실시간 + REST 보완 |
| 라이브 | `POST /live-sessions/{id}/start`·`/token`·`/end` | 시작(토큰+Egress 녹화 시작)·LiveKit 토큰(publish/subscribe)·종료 |

## 3. 내부 계약 (확정 인터페이스)

### 3-1. Spring → AI 배치 잡 (RabbitMQ)
잡 envelope: `{ jobId, idempotencyKey, tenantId, courseId, lessonId, taskType, inputRefs, policy, contractVersion, correlationId }`. taskType: `PPTX_PARSE|EMBED|CANDIDATE_GEN|STT_2PASS`. (라이브 STT는 배치 아님 — Redis Streams §3-3. 트랜스코드는 없음 — VOD=Egress 녹화, [decisions/0010](decisions/0010-self-host-vod.md)) **outbox**로 발행 신뢰성, 실패는 **DLQ**.

### 3-2. AI → Spring callback (HTTP, 서명)
`{ eventId, eventType, jobId, lessonId, status, outputs }`. eventType 예: `LESSON_AI_READY`. Spring은 `eventId`로 중복 제거(멱등), 산출물을 ai schema에 두고 강사 게시 시 core로 반영.

### 3-3. AI → Spring 실시간 (Redis Streams, STT/자막)
세션별 스트림. 메시지: `caption.partial|final|revised { sessionId|lessonId, segmentId, startMs, endMs, text, revision }` · `term` · `evidence` · `summary`. (라이브 STT 실시간 전달; 다시보기는 저장본 재생 — [decisions/0013](decisions/0013-unified-streaming-stt.md))

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
