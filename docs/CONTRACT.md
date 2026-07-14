# CONTRACT.md — 공유 계약 (정본)

> 📍 하네스 개요: [docs/harness/README.md](harness/README.md) · 정본 규칙: [AGENTS.md](../AGENTS.md) · 아키텍처: [architecture.md](architecture.md)
>
> **FE↔Spring**, **Python↔Spring**이 동시에 지켜야 어긋나지 않는 계약만 모은다. 한쪽이 바꾸면 다른 쪽이 깨지는 항목.
> (구 화상회의 명세 [SPEC.md](SPEC.md)는 참고용 — [decisions/0003](decisions/0003-greenfield-redesign.md))

---

## 1. 필드명 규칙 — **camelCase 통일**

> 근거: [decisions/0001-field-name-camelcase.md](decisions/0001-field-name-camelcase.md) (팀 자체 컨벤션)

- **API JSON 요청/응답 필드명은 `camelCase`.** 예: `sessionId`, `hostUserId`, `startMs`, `isActive`, `thumbnailUrl`, `materialVersionId`.
- **DB 컬럼은 `snake_case` 허용**하되, DTO/request/response로 노출되는 순간 camelCase 계약을 따른다.
- 코드 내부 식별자(변수·함수)는 정적 규칙이라 린트 대상([POLICY](harness/POLICY.md)).

---

## 2. REST API (`/api/v1`)

### 인증·회원 (구현 진행)
| 엔드포인트 | 성공 | 실패 |
|---|---|---|
| `POST /auth/login` | 200 (+JWT) | 401 비번불일치 / 404 계정없음 |
| `POST /users` (회원가입) | **201** | — |
| `GET /users/me` | 200 (프로필) | 401/403 |
| `GET /users/{userId}` (중복확인) | 200 | **409** |
| `PATCH /users/{userId}` | 200 | 403 |
| `DELETE /users/{userId}` | 204 | 403 |

### 세션 (신규 도메인, CP0~ 착수 시 상세 확정)
| 엔드포인트 | 성공 | 비고 |
|---|---|---|
| `POST /sessions` | **201** (+`sessionId`) | 강사만. PDF 업로드 → `materialVersion` |
| `GET /sessions` · `GET /sessions/{id}` | 200 | 목록·상세 |
| `PATCH /sessions/{id}` | 200 | host만 |
| 세션 시작/입장/종료 | — | LiveKit 토큰 발급·Egress·AI 세션 연동 |

> **상태코드 규격**: 생성 **201**, 중복 **409**, 인증 실패 **401**, 권한 **403**. FE 분기가 의존.

---

## 3. 실시간·서비스 간 계약 (확정 인터페이스)

> Python↔Spring 브릿지는 [architecture.md](architecture.md)의 확정 인터페이스. 시간은 전부 **세션 상대 ms**.

### 3-1. Python → Spring (Redis Streams, 라이브 enrichment 푸시)
세션별 스트림. 메시지 타입:
- `caption.partial` / `caption.final` / `caption.revised`: `{ sessionId, segmentId, startMs, endMs, text, revision }`
- `term`: `{ sessionId, segmentId, term, spanStart, spanEnd }`
- `evidence`: `{ sessionId, segmentId, source, quote }` (source = `materialVersion`+page 또는 `transcriptSegment`)
- `summary`: `{ sessionId, sections: [{ anchorMs, title }] }`

### 3-2. Q&A (동기, Spring ↔ Python — 스트림 아님)
- 요청 `Spring→Python`: `{ sessionId, userId, question, sessionMs, policy }`
- 응답 `Python→Spring`: `{ answer, evidence: [...] }` → **Spring이 요청자 채널로만** 전달(비공개). LLM은 클라이언트 직결 금지.

### 3-3. FE ↔ Spring WebSocket
- **자막 채널**(세션별 구독): 서버가 caption 이벤트 push(partial/final/revised + term/evidence).
- **채팅 채널**(세션별): `chat_message { sessionId, userId, sessionMs, text }`.

### 3-4. LiveKit 토큰 (Spring 발급)
- `{ room = session.livekitRoom, identity = userId, grants(role별 publish/subscribe) }`.

---

## 4. 기능 ↔ 오너 맵 (CP 기준)

> 역할 분담 시 채움. 공유 계약(이 문서·AGENTS.md) 수정은 [CODEOWNERS](../CODEOWNERS) 승인 필요.

| CP | 영역 | 오너 | 관련 계약 |
|---|---|---|---|
| CP0 | 인증·회원·세션 CRUD | _미정_ | §2 |
| CP1~2 | VOD 자막·용어·근거(RAG) | _미정_ | §1, §3-1, §3-2 |
| CP3 | 라이브 미디어(LiveKit)·채팅 | _미정_ | §3-3, §3-4 |
| CP4~5 | 라이브 자막·되감기 | _미정_ | §3-1, 세션시계 |
| CP6 | 개인 Q&A·따라잡기 | _미정_ | §3-2 |

---

## 5. 계약 변경 절차
1. 변경 전 오너 합의 → 확정 결정은 [decisions/](decisions/)에 ADR.
2. 걸린 양쪽(FE·BE, 또는 Python·Spring)을 **함께** 수정.
3. 이 문서·관련 계약 테스트 갱신.
4. MR 체크리스트의 계약 항목 체크.
