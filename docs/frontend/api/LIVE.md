# 라이브 세션 준비·입장·라이브 레슨 API

> 공통 규칙: [API_MAP.md](API_MAP.md) · 세션 화면: [LIVE_SESSION.md](../components/LIVE_SESSION.md) · 강의실 화면: [LIVE_LESSON.md](../components/LIVE_LESSON.md) · 공유 계약: [CONTRACT.md](../../CONTRACT.md)

## 1. 범위

live session 생성·수정·상세, 수강생 prejoin, 강사 preflight, 시작·입장·종료, LiveKit, 채팅·자막 WebSocket, AI Q&A SSE, 라이브 되감기 HLS, 질문 핀과 북마크 계약을 정의한다.

### 1.1 식별자와 상태

- `lessonId`: 레슨 콘텐츠와 학습 기능 식별자
- `sessionId`: 실제 라이브 일정·입장·미디어·시간축 식별자
- MVP는 `lesson : liveSession = 1:1`
- 시간 데이터는 라이브 시작 기준 `sessionMs`
- 프론트는 예정 시각으로 상태를 추론하지 않고 서버 상태와 `allowedActions`를 사용

```text
DRAFT → SCHEDULED → OPEN → STARTING → LIVE → ENDING → ENDED
   └──────────────→ CANCELLED
STARTING ─────────→ FAILED
```

### 1.2 미디어 권한

- 강사 LiveKit token: publish·subscribe 허용
- 수강생은 LiveKit token을 발급받지 않고 HLS로만 시청
- 수강생 카메라·마이크·화면 공유는 현재 범위에서 제공하지 않음
- 후속 발언 요청·승인 기능이 생길 때만 단명 publish 권한을 별도 발급

## 2. API·연결 목록

### 2.1 일정·상태·미디어 제어

| ID | Method | Path | 설명 | 상태 |
|---|---|---|---|---|
| `LIVE-SESSION-01` | `POST` | `/api/instructor/lessons/{lessonId}/live-sessions` | 세션 생성 | **제안** |
| `LIVE-SESSION-02` | `PATCH` | `/api/instructor/live-sessions/{sessionId}` | 일정 수정 | **제안** |
| `LIVE-SESSION-03` | `GET` | `/api/live-sessions/{sessionId}` | 역할별 세션 상세 | **제안** |
| `LIVE-SESSION-04` | `POST` | `/api/instructor/live-sessions/{sessionId}/cancel` | 시작 전 취소 | **제안** |
| `LIVE-SESSION-05` | `POST` | `/api/instructor/live-sessions/{sessionId}/preflight` | 서버·미디어 시작 조건 점검 | **제안** |
| `LIVE-SESSION-06` | `POST` | `/api/live-sessions/{sessionId}/start` | 멱등 라이브 시작 | URL **확정** |
| `LIVE-SESSION-07` | `POST` | `/api/instructor/live-sessions/{sessionId}/token` | 소유 강사 LiveKit 송출 token 발급 | URL **확정** |
| `LIVE-SESSION-08` | `POST` | `/api/live-sessions/{sessionId}/end` | 멱등 라이브 종료 | URL **확정** |
| `LIVE-SESSION-09` | `GET` | `/api/instructor/live-sessions/{sessionId}/processing` | 종료 후 녹화·AI 처리 조회 | **제안** |
| `LIVE-PLAYBACK-01` | `GET` | `/api/live-sessions/{sessionId}/playback` | 최근·전체 DVR HLS 재생 정보 | **제안** |

### 2.2 실시간·학습

| ID | Transport | Path/Channel | 설명 | 상태 |
|---|---|---|---|---|
| `LIVE-WS-01` | WebSocket | `/api/ws` | 인증 쿠키 기반 WS 연결 | **제안** |
| `CHAT-01` | REST | `GET/POST /api/live-sessions/{sessionId}/messages` | 채팅 복구 조회·전송 fallback | **구현됨(세션 키잉)** |
| `CAPTION-01` | REST | `GET /api/live-sessions/{sessionId}/captions` | 저장 자막 리로드(새로고침·재연결 복구) | **구현됨(ADR-0045)** |
| `AI-QUESTION-01` | SSE | `POST /api/lessons/{lessonId}/ai/questions:stream` | 개인 AI Q&A | URL **확정** |
| `AI-TERM-01` | REST | `POST /api/lessons/{lessonId}/ai/terms:explain` | 전문용어 설명 | URL **확정** |
| `LIVE-QUESTION-01` | REST | `GET /api/instructor/live-sessions/{sessionId}/question-pins` | 강사용 질문 시점 집계 | **제안** |
| `LIVE-QUESTION-02` | REST | `GET /api/instructor/live-sessions/{sessionId}/question-pins/{pinId}/questions` | 핀의 익명 질문 원문 | **제안** |
| `BOOKMARK-01` | REST | `GET/POST /api/lessons/{lessonId}/bookmarks` | 내 북마크 조회·생성 | URL 계열 **확정** |
| `BOOKMARK-02` | REST | `DELETE /api/lessons/{lessonId}/bookmarks/{bookmarkId}` | 내 북마크 삭제 | **제안** |

## 3. 세션 생성·수정·상세

### 3.1 `LIVE-SESSION-01` 생성

```http
POST /api/instructor/lessons/{lessonId}/live-sessions
```

```json
{
  "scheduledAt": "2026-08-01T10:00:00+09:00",
  "expectedDurationMinutes": 90,
  "entryWindowMinutes": 10,
  "saveAsDraft": false
}
```

```json
{
  "sessionId": "ses_01J...",
  "lessonId": "les_01J...",
  "liveSessionStatus": "SCHEDULED",
  "scheduledAt": "2026-08-01T10:00:00+09:00",
  "entryOpensAt": "2026-08-01T09:50:00+09:00",
  "allowedActions": ["EDIT_SESSION", "CANCEL_SESSION", "RUN_PREFLIGHT"]
}
```

- lesson 게시·AI 준비 전에도 예약 가능
- 기존 session이 있으면 `409 LIVE_SESSION_ALREADY_EXISTS`와 기존 `sessionId` 반환
- 동일 강사 일정 충돌은 `409 INSTRUCTOR_SCHEDULE_CONFLICT`
- `saveAsDraft=true`이면 `DRAFT`, 아니면 검증 후 `SCHEDULED`

### 3.2 `LIVE-SESSION-02` 수정

```http
PATCH /api/instructor/live-sessions/{sessionId}
```

생성과 같은 일정 필드를 사용한다. `DRAFT`, `SCHEDULED`에서 허용하고 `OPEN` 이후 범위는 서버 `allowedActions`를 따른다. `STARTING` 이후에는 `409 LIVE_SESSION_STATE_CONFLICT`를 반환한다.

### 3.3 `LIVE-SESSION-03` 역할별 상세

```http
GET /api/live-sessions/{sessionId}
```

```json
{
  "sessionId": "ses_01J...",
  "lesson": {
    "lessonId": "les_01J...",
    "title": "Spring Security 시작하기",
    "status": "PUBLISHED",
    "sectionId": "sec_01J...",
    "curriculumId": "cur_01J...",
    "curriculumTitle": "실시간 Spring 입문"
  },
  "liveSessionStatus": "OPEN",
  "scheduledAt": "2026-08-01T10:00:00+09:00",
  "entryOpensAt": "2026-08-01T09:50:00+09:00",
  "expectedDurationMinutes": 90,
  "startedAt": null,
  "endedAt": null,
  "notices": {
    "recordingEnabled": true,
    "captionEnabled": true,
    "chatEnabled": true,
    "aiEnabled": true
  },
  "readiness": {
    "lessonPublished": true,
    "materialReady": true,
    "aiReady": true,
    "materialOperationInProgress": false
  },
  "viewerContext": {
    "relationship": "ENROLLED",
    "allowedActions": ["RUN_PREJOIN", "WAIT_FOR_LIVE"]
  }
}
```

강사에게만 공개 가능한 시작 차단 요약을 추가할 수 있지만, 인프라 내부 endpoint·stack trace·스토리지 경로는 노출하지 않는다.

### 3.4 취소

```http
POST /api/instructor/live-sessions/{sessionId}/cancel
```

```json
{
  "reason": "일정 변경"
}
```

`DRAFT`, `SCHEDULED`, 정책상 허용된 `OPEN`에서만 처리한다. 성공 시 최신 session을 `200`으로 반환한다.

## 4. 수강생 prejoin과 강사 preflight

### 4.1 수강생 prejoin

스피커, autoplay, 네트워크 점검은 브라우저에서 수행하며 서버 API 결과로 가장하지 않는다. 서버는 `LIVE-SESSION-03`에서 다음을 판정한다.

- 인증·활성 수강·lesson 게시 상태
- session 상태와 입장 가능 창
- 녹화·자막·채팅·AI 고지
- token 요청 가능 여부

카메라·마이크 권한은 수강생 prejoin에서 요청하지 않는다.

수강생의 모든 강의실 진입 동선은 prejoin을 먼저 거친다. 프론트는 점검 완료 문맥 없이 `/student/live-sessions/{sessionId}/classroom`에 직접 접근하면 `/student/live-sessions/{sessionId}/prejoin`으로 이동시킨다. 실제 입장 권한과 `LIVE` 상태는 이후 LiveKit token 발급에서 서버가 다시 검증한다.

### 4.2 `LIVE-SESSION-05` 강사 preflight

```http
POST /api/instructor/live-sessions/{sessionId}/preflight
```

```json
{
  "checks": [
    {"code": "LESSON_PUBLISHED", "status": "PASS", "blocking": true},
    {"code": "MATERIAL_READY", "status": "PASS", "blocking": true},
    {"code": "AI_READY", "status": "PASS", "blocking": true},
    {"code": "LIVEKIT_READY", "status": "PASS", "blocking": true},
    {"code": "EGRESS_READY", "status": "PASS", "blocking": true},
    {"code": "STT_READY", "status": "PASS", "blocking": true}
  ],
  "canStart": true,
  "checkedAt": "2026-08-01T09:55:00+09:00",
  "expiresAt": "2026-08-01T09:56:00+09:00"
}
```

카메라·마이크 장치 점검은 브라우저가 별도로 수행한다. 서버 preflight가 통과해도 브라우저 필수 장치 점검 실패 시 프론트가 시작 버튼을 차단한다.

AI 미준비, LiveKit, Egress, STT 시작 문제는 우회 없이 차단한다. 라이브 시작 후 발생한 Egress·STT 장애는 라이브를 유지하고 degraded 상태로 전환한다.

## 5. 시작·토큰·종료

### 5.1 `LIVE-SESSION-06` 시작

```http
POST /api/live-sessions/{sessionId}/start
Idempotency-Key: 01J...
```

```json
{
  "preflightCheckedAt": "2026-08-01T09:55:00+09:00"
}
```

**접수 응답 — `202 Accepted`**

```json
{
  "sessionId": "ses_01J...",
  "liveSessionStatus": "STARTING",
  "operationId": "lop_01J..."
}
```

- 강사 소유권, 최신 preflight, lesson `PUBLISHED`, AI 준비, session 상태를 다시 검증
- LiveKit room·Egress·STT 시작을 조정
- 동일 멱등 키와 중복 시작은 기존 operation 또는 이미 `LIVE`인 session으로 수렴
- 프론트는 `STARTING` timeout을 임의로 실패 처리하지 않고 상세를 재조회
- 성공 후 `LIVE` 상태를 확인한 다음 classroom으로 이동

### 5.2 `LIVE-SESSION-07` 강사 LiveKit token

```http
POST /api/instructor/live-sessions/{sessionId}/token
```

```json
{
  "connectionType": "LIVEKIT",
  "livekitUrl": "wss://livekit.example.com",
  "accessToken": "short-lived-livekit-jwt",
  "expiresAt": "2026-08-01T10:10:00+09:00",
  "participant": {
    "identity": "opaque-participant-id",
    "displayName": null
  },
  "grants": {
    "canSubscribe": true,
    "canPublish": true,
    "canPublishData": true
  }
}
```

- 소유 강사만 요청할 수 있으며 학생은 역할 게이트 403, 비소유 강사는 `403 LIVE_SESSION_FORBIDDEN`이다.
- 수강생은 이 endpoint를 호출하지 않고 HLS playback metadata를 조회한다.
- 구 공용 경로 `/api/live-sessions/{sessionId}/token`은 제공하지 않는다.
- token은 로그·분석 이벤트·영속 저장에 남기지 않는다.
- 만료·재연결 시 같은 endpoint로 새 token을 요청한다.

### 5.3 `LIVE-SESSION-08` 종료

```http
POST /api/live-sessions/{sessionId}/end
Idempotency-Key: 01K...
```

```json
{
  "sessionId": "ses_01J...",
  "liveSessionStatus": "ENDING",
  "operationId": "lop_01K..."
}
```

- 강사만 요청 가능
- 신규 입장 차단, room 종료, Egress stop/finalize를 조정
- room 종료 확정 후 session `ENDED`
- Egress 완료는 별도 `videoAssetStatus`로 추적
- 중복 종료 요청은 기존 종료 operation으로 수렴

## 6. 라이브 classroom 초기 데이터

classroom 진입 시 다음 순서로 호출한다.

1. `LIVE-SESSION-03`으로 권한·`LIVE` 상태 확인
2. **강사만** `LIVE-SESSION-07`로 LiveKit 발행 token 발급 — 학생은 LiveKit에 붙지 않는다(HLS 단일, [ADR-0032](../../decisions/songjeongki/0032-media-playback-hls-only.md))
3. `LIVE-PLAYBACK-01`로 HLS 재생 정보 조회 — **학생의 라이브 시청 원천**(라이브 엣지)이자 되감기 범위
4. `CHAT-01`, `CAPTION-01`, `BOOKMARK-01`로 저장 데이터 복원
5. WebSocket 연결 후 실시간 이벤트 구독

세션 상세가 `LIVE`가 아니면 강사 LiveKit token을 선발급하지 않는다.

## 7. 라이브 되감기 HLS

### 7.1 `LIVE-PLAYBACK-01`

```http
GET /api/live-sessions/{sessionId}/playback
```

```json
{
  "sessionId": "ses_01J...",
  "startedAt": "2026-08-01T10:00:00+09:00",
  "currentSessionMs": 1800000,
  "sources": {
    "recent": {
      "url": "https://media.example.com/recent.m3u8?...",
      "availableFromMs": 1200000,
      "availableToMs": 1780000,
      "expiresAt": "2026-08-01T10:35:00+09:00"
    },
    "dvr": {
      "url": "https://media.example.com/dvr.m3u8?...",
      "availableFromMs": 0,
      "availableToMs": 1760000,
      "expiresAt": "2026-08-01T10:35:00+09:00"
    }
  }
}
```

- 재생은 **HLS 단일**이다([ADR-0032](../../decisions/songjeongki/0032-media-playback-hls-only.md)) — 라이브 시점도 HLS를 **라이브 엣지**에서 재생(`live.m3u8`, `#EXT-X-ENDLIST` 없음)하고, 과거 시점은 **같은 HLS를 seek**한다. WebRTC 직접 구독·렌더 경로는 없다.
- `recent` 범위를 벗어나면 같은 `sessionMs`를 유지해 `dvr`로 전환(둘 다 HLS)
- URL 만료 시 endpoint를 재호출
- Egress 실패 시 `sources` 일부 또는 전체가 `null`이고 공개 가능한 상태 코드를 제공. **Egress가 라이브 HLS의 유일 원천이므로 실패하면 라이브 시청 자체가 끊긴다**(WebRTC 복귀 경로 없음) — 채팅·자막은 유지.
- HLS 실패는 재시도·상태 코드로 처리한다(WebRTC fallback 없음)

최근 유지 범위, DVR 누적 playlist 제공 방식, Egress 지연 보정(LL-HLS 2~6초 목표)은 구현 전 인프라 검증이 필요하다([ADR-0032](../../decisions/songjeongki/0032-media-playback-hls-only.md) 후속 실측).

## 8. WebSocket 계약

### 8.1 연결과 envelope 제안

```text
GET /api/ws
Cookie: session=...
```

봉투(`WsEnvelope`)는 채팅과 동형에 `occurredAt`이 더 있다:

```json
{
  "type": "caption.delta",
  "sessionId": "ses_01J...",
  "occurredAt": "2026-08-01T10:02:00+09:00",
  "payload": { "sttSessionId": "stt_01J...", "sequence": 12, "streamElapsedMs": 42000, "sessionMs": 41000, "text": "SecurityContext가 " }
}
```

채널(구현됨 — STOMP `/api/ws`):

| 채널 | 수신 이벤트 | 상태 |
|---|---|---|
| `/topic/live-sessions/{sessionId}/captions` | `caption.delta`, `caption.stream.completed` | **구현됨(ADR-0043)** |
| `/topic/live-sessions/{sessionId}/chat` | `chat.message.created` | **구현됨** |
| `/topic/live-sessions/{sessionId}/state` | `session.starting`, `session.live`, `session.ending`, `session.ended`, degraded 상태 | 제안 |
| `/topic/live-sessions/{sessionId}/presence` | 참가자 수·접속 요약 | 제안 |

구독 인가(참가자만)는 서버 STOMP 인터셉터가 정확 매칭으로 처리한다(와일드카드 구독 차단, ADR-0043) — FE는 토픽만 구독한다.

### 8.2 자막 payload — 델타 스트림(CONTRACT §3-4 / ADR-0040·0043)

> **옛 `caption.partial|final|revised` 세그먼트 모델은 폐기됐다.** 실시간 STT 원출력은 확정 문장이 아니라
> append-only 증분이라, 계약은 델타 전송 모델로 개정됐다(ADR-0040). 지금 서버가 발행하는 라이브 이벤트는
> **`caption.delta`·`caption.stream.completed` 2종뿐**이다(`segment.final`도 아직 없음).

`caption.delta` payload — **append-only 증분**:

```json
{ "sttSessionId": "stt_01J...", "sequence": 12, "streamElapsedMs": 42000, "sessionMs": 41000, "text": "이어지는 조각" }
```

- `sttSessionId`: 한 STT job attempt. **이것이 곧 한 자막 라인의 정체성**이다(같은 attempt의 델타가 한 라인으로 모인다).
- `sequence`: `(sessionId, sttSessionId)` attempt 범위에서만 증가. retry(새 `sttSessionId`)마다 1부터 다시 시작할 수 있다.
- `streamElapsedMs`: **agent 첫 오디오 프레임=0 기준 stream-local(attempt) 경과 ms**. 세션 상대 ms가 **아니다** — 세션 ms로 변환하지 말고 그대로 표시한다(계약 강제).
- `sessionMs`(Long, **nullable**): 서버가 계산한 **근사 세션-ms**(`max(0, occurredAt − clockOriginAt)`, ADR-0045). HLS 영상 위치(`positionMs`)와 **같은 세션 축**이라 학생 위치 동기화의 기준이다. `streamElapsedMs` 변환이 아니라 occurredAt 기반 별도 근사 축이며, clockOriginAt이 없으면 `null`(그때는 `streamElapsedMs`로 fallback). 근사 오차 ~1~2s.
- `text`: 이전까지 텍스트에 이어 붙일 증분. FE는 `sttSessionId`별로 `sequence` 순서로 이어 붙여 "자라는" 라인을 만든다.

`caption.stream.completed` payload — 스트림 종료 마커(해당 `sttSessionId`에 더 이상 델타 없음):

```json
{ "sttSessionId": "stt_01J...", "lastSequence": 12, "sessionMs": 43000, "reason": "ROOM_DELETED" }
```

FE 소비 구현: 봉투 파싱은 `httpLiveSessionService.subscribeCaptions`, 누적·CaptionView 매핑은 `captionAdapter`
(`reduceCaptionStream`/`selectCaptionViews`), 렌더는 `CaptionDock`(확정 전 라인은 `pending`). 상세 근거는 ADR-0044·0045.

**뷰어별 위치 동기화(ADR-0045)**: 자막 시각을 `sessionMs`(있으면) 축에 두고, `LiveClassroomPage`가 뷰어에 따라 노출을 가른다.
- **학생(HLS/replay, 플레이어 위치 존재)**: `selectVisibleCaptions`가 `positionMs`(+STT 지연 보정)까지의 위치 동기화(`synced`) 자막만 노출한다. 앞선 자막은 누적기(버퍼)에 두고 위치가 도달하면 드러나 — HLS 지연으로 자막이 영상보다 앞서던 문제를 없앤다. 현재 cue는 위치에 도달한 마지막 라인으로 강조한다.
- **강사(라이브, 위치 미구동)**: 기존 실시간 append 그대로.
- `sessionMs`가 없어 fallback(`synced=false`)인 자막은 위치 축이 아니라 판단 불가라 그대로 보인다.

**STT 방출 지연 보정(`CAPTION_STT_LAG_MS`=1,500)**: `sessionMs`는 조각을 **내보낸** 시각이라 실제 발화보다 늦다(`startMs ≈ 발화시각 + lag`). 같은 상수로 두 곳을 보정한다 — 노출은 `positionMs + lag`까지(말이 들리는 순간에 뜨도록), 시각 라벨 클릭 seek은 `startMs − lag`으로(문장 **시작**에 닿도록, 라벨 텍스트는 자막 시각 그대로). 두 값이 같아 자막을 눌러 이동한 직후에도 그 줄이 경계에 걸려 사라지지 않는다. 세그먼트형(다시보기) 자막은 정확한 구간이라 보정하지 않는다(`captionSeekMs`). 또 한 델타의 시작 시각으로는 **직전 델타의 시각**을 쓴다 — 델타 시각은 방출 시점이라, 그 조각의 말이 시작된 때는 직전 델타 무렵이기 때문이다.

**Bounded 누적(롤링 캡)**: 누적기는 최근 `CAPTION_MAX_LINES`(=300) 라인만 보관하고 초과 시 가장 오래된 라인을 drop한다 — 긴 세션에서 메모리·DOM(<article> 수)이 무한정 커지지 않게. 학생 위치 버퍼는 HLS 지연분(~수십초)뿐이라 넉넉하다. 풀 가상 스크롤은 쓰지 않는다.

### 8.3 재연결·새로고침 자막 복구(구현됨, CAPTION-01/ADR-0045)

`CAPTION-01`(`GET /api/live-sessions/{sessionId}/captions`)로 저장된 자막을 **세션-ms 순**으로 리로드한다. 각 항목은
WS 델타/종료와 **같은 필드**(근사 `sessionMs` 포함)라, `LiveClassroomPage` 마운트 시 이 목록을 WS 누적기에 그대로
시드해 새로고침·재연결 뒤 이전 자막을 복원한다(`getCaptions` → `reduceCaptionStream`). WS 델타와 **멱등 병합**되므로
WS가 먼저 붙어 일부가 쌓였어도 순서 무관하게 안전하다(중복 sequence 무시, 누락분만 채움). 실시간 렌더는 이어서
`subscribeCaptions`(WS)가 구동하며, 리로드 실패는 진입 게이트를 막지 않는다(자막 없이도 미디어·채팅은 산다).
정본 복구는 녹화 2-pass(CP4)·`GET /lessons/{id}/transcript`의 몫이고, 롤링 캡을 넘어 drop된 오래된 이력의
리로드-온디맨드는 이번 범위 밖(후속).

## 9. 채팅

### 9.1 메시지 생성

WS 전송을 기본으로 하되 REST fallback도 같은 command DTO를 사용한다.

```http
POST /api/live-sessions/{sessionId}/messages
```

채팅은 **세션 키잉(구현됨)**이다. `sessionId`는 경로로 전달하므로 본문에 다시 넣지 않는다.

```json
{
  "clientMessageId": "local-01J...",
  "text": "이 부분을 다시 설명해 주세요.",
  "isQuestion": true,
  "viewingSessionMs": 118000
}
```

```json
{
  "messageId": "msg_01J...",
  "clientMessageId": "local-01J...",
  "lessonId": "les_01J...",
  "sessionId": "ses_01J...",
  "sessionMs": 120500,
  "viewingSessionMs": 118000,
  "text": "이 부분을 다시 설명해 주세요.",
  "isQuestion": true,
  "alias": "수강생 12",
  "createdAt": "2026-08-01T10:02:00+09:00"
}
```

`sessionMs`는 서버 수신 시각, `viewingSessionMs`는 되감기 중 사용자가 보고 있던 시각이다. 질문 핀의 기준을 둘 중 무엇으로 할지는 협의가 필요하다. 일반 채팅을 내용으로 자동 질문 분류하지 않는다.

### 9.2 복구 조회

```http
GET /api/live-sessions/{sessionId}/messages?afterSessionMs=115000&limit=100
```

가명, 삭제·제재 상태, `isQuestion`을 포함한다. 사용자 실명과 내부 userId는 수강생 채팅 응답에 포함하지 않는다.

## 10. 개인 AI Q&A와 용어

### 10.1 AI 질문 SSE

```http
POST /api/lessons/{lessonId}/ai/questions:stream
Accept: text/event-stream
```

```json
{
  "sessionId": "ses_01J...",
  "sessionMs": 118000,
  "question": "SecurityFilterChain이 무엇인가요?",
  "difficulty": "BEGINNER"
}
```

제안 SSE event:

| event | data |
|---|---|
| `meta` | `questionId`, 기준 `sessionMs`, 사용한 content version |
| `delta` | 답변 텍스트 조각 |
| `citation` | 자료·자막 근거와 연결 시각 |
| `done` | 완료 상태 `ANSWERED` 또는 `INSUFFICIENT_EVIDENCE` |
| `error` | 안정적인 오류 코드와 `correlationId` |

근거 제안:

```json
{
  "evidenceId": "evd_01J...",
  "type": "MATERIAL",
  "materialId": "mat_01J...",
  "fileName": "security-basics.pptx",
  "slideNumber": 12,
  "excerpt": "SecurityFilterChain ...",
  "sessionMs": 116000
}
```

React는 Spring만 호출하며 Python AI endpoint를 직접 호출하지 않는다. 사용자의 개인 답변 기록은 강사에게 제공하지 않고 질문 원문·시점만 익명 집계에 반영한다.

### 10.2 용어 설명

```http
POST /api/lessons/{lessonId}/ai/terms:explain
```

```json
{
  "sessionId": "ses_01J...",
  "sessionMs": 118000,
  "term": "SecurityFilterChain"
}
```

응답은 짧은 설명과 자료·발화 근거를 반환한다. 근거가 부족하면 정상 응답의 `status=INSUFFICIENT_EVIDENCE` 또는 명시 오류 중 하나로 통일한다.

## 11. 북마크

```http
POST /api/lessons/{lessonId}/bookmarks
```

```json
{
  "sessionId": "ses_01J...",
  "sessionMs": 118000
}
```

```json
{
  "bookmarkId": "bmk_01J...",
  "lessonId": "les_01J...",
  "sessionMs": 118000,
  "createdAt": "2026-08-01T10:02:00+09:00"
}
```

- 같은 사용자의 같은 레슨·가까운 시각 중복 정책은 협의 필요
- `GET`은 라이브와 VOD에서 같은 북마크를 반환
- `DELETE /bookmarks/{bookmarkId}`는 본인 북마크만 삭제

## 12. 강사용 질문 핀

### 12.1 집계

```http
GET /api/instructor/live-sessions/{sessionId}/question-pins?bucketMs=30000
```

```json
{
  "totalQuestionCount": 18,
  "pins": [
    {
      "pinId": "pin_01J...",
      "startMs": 90000,
      "endMs": 120000,
      "questionCount": 5,
      "intensity": "HIGH",
      "sources": {
        "flaggedChat": 3,
        "personalAi": 2
      }
    }
  ]
}
```

### 12.2 익명 질문 원문

```http
GET /api/instructor/live-sessions/{sessionId}/question-pins/{pinId}/questions?page=0&size=50
```

```json
{
  "items": [
    {
      "questionId": "qst_01J...",
      "source": "FLAGGED_CHAT",
      "sessionMs": 105000,
      "text": "필터 순서를 다시 설명해 주세요."
    }
  ],
  "page": 0,
  "size": 50,
  "totalElements": 5
}
```

userId, 실명, 가명과 개인 AI 답변은 포함하지 않는다. 초기에는 의미 기반 유사 질문 묶음을 제공하지 않는다.

## 13. 종료 후 처리 조회

```http
GET /api/instructor/live-sessions/{sessionId}/processing
```

```json
{
  "sessionId": "ses_01J...",
  "liveSessionStatus": "ENDED",
  "videoAsset": {
    "videoAssetId": "vid_01J...",
    "status": "VERIFYING",
    "attempt": 1,
    "failureCode": null
  },
  "aiPostProcessing": {
    "status": "PROCESSING",
    "transcript": "PROCESSING",
    "glossary": "NOT_STARTED",
    "chapters": "NOT_STARTED",
    "quiz": "NOT_STARTED"
  },
  "replayStatus": "NOT_READY",
  "allowedActions": []
}
```

`videoAssetStatus`: `FINALIZING`, `VERIFYING`, `READY`, `FAILED` 제안. HLS가 `READY`여도 replay는 자동 게시하지 않는다.

## 14. 오류·장애 원칙

| 장애 | 계약 |
|---|---|
| AI Q&A 실패 | 미디어·채팅 유지, SSE 오류만 표시 |
| STT 실패 | 미디어·채팅 유지, degraded 이벤트와 자막 중단 표시 |
| Egress 실패 | 라이브 HLS 원천 상실 → 라이브 시청 중단·상태 표시, 채팅·자막 유지, 되감기·VOD 위험 표시 |
| 최근 HLS 실패 | DVR HLS fallback(같은 HLS 단일) |
| 전체 HLS 실패 | 라이브 시청 불가 표시(WebRTC 복귀 경로 없음, ADR-0032), 종료 후 VOD 안내 |
| 채팅 WS 실패 | REST 누락 복구·전송 fallback |
| LiveKit 실패 | token 재발급·재연결, 다른 영역 상태는 별도 유지 |

공통 상태코드 외 주요 충돌 코드는 `LIVE_SESSION_STATE_CONFLICT`, `LIVE_START_BLOCKED`, `LIVE_ALREADY_STARTED`, `LIVE_END_IN_PROGRESS`, `LIVE_ENTRY_NOT_OPEN`, `LIVE_TOKEN_FORBIDDEN`을 제안한다.

## 15. 백엔드 협의 사항

1. 기본 입장 가능 창·예상 진행 시간 규칙
2. `OPEN`을 저장 상태 또는 서버 계산 상태로 둘지
3. 시작·종료 operation polling 또는 WS 상태 이벤트 방식
4. LiveKit token TTL, 재발급, 중복 접속과 이전 연결 정책
5. WS protocol(STOMP 여부), endpoint, destination, 재연결 cursor
6. 채팅 질문 핀 시각을 전송 `sessionMs` 또는 `viewingSessionMs`로 사용할지
7. recent HLS 유지 범위와 녹화 중 DVR playlist 제공 방식
8. Egress·STT degraded event와 공개 가능한 failure code
9. 질문 핀 bucket 크기와 intensity 계산 기준
10. 북마크 중복 기준
11. `FAILED` 세션 재시도 또는 새 세션 생성 정책
