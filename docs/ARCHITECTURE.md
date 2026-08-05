# LiveClass AI — 아키텍처

> 📍 하네스 개요: [harness/README.md](harness/README.md) · 정본 규칙: [../AGENTS.md](../AGENTS.md) · 로드맵: [CP-ROADMAP.md](CP-ROADMAP.md) · 계약: [CONTRACT.md](CONTRACT.md)
>
> LiveClass AI의 **아키텍처 기준선**. 지어진 부분은 **구현 기준**으로 서술하고, 아직 안 지어진 부분은 **설계 의도로 명시**한다.
> 결정 근거는 [decisions/](decisions/) ADR에 있고, 결정이 바뀌면 이 문서와 해당 ADR을 함께 갱신한다.

**범례** — 이 문서 전체에서 사용:

| 표기 | 뜻 |
|---|---|
| ✅ | 구현·동작 확인됨 |
| 🟡 | 일부만 구현 (뒤에 남은 부분 명시) |
| ⬜ | 미착수 — 설계 의도 |

---

## 1. 제품 한 줄

**실시간 라이브 강의 플랫폼** — 강사가 WebRTC로 라이브 강의를 하고, 실시간 **자막·용어·자료 근거 RAG**를 제공한다.
지난 라이브는 **녹화 다시보기**로 제공하고, 강사가 올린 MP4도 별도 **녹화강의**로 제공한다.
두 영상은 학생에게 HLS로 재생되며 라이브 생명주기와 업로드 변환 생명주기는 분리한다.
([ADR-0010](decisions/songjeongki/0010-self-host-vod.md) 라이브 VOD · [ADR-0008](decisions/choinhoo/0008-recorded-lesson-upload-and-hls-transcoding.md) 업로드 녹화강의)

---

## 2. 확정 스택

| 컴포넌트 | 스택 | 상태 | 근거 ADR |
|---|---|---|---|
| Front-end | React 19 + TypeScript, TanStack Query 5, Vite | ✅ | [0002](decisions/songjeongki/0002-react-typescript-frontend.md) |
| 컨트롤/데이터 | Spring Boot 4.1 + Java 21, JPA, Security, **Spring Modulith 2.1** | ✅ | [0006](decisions/songjeongki/0006-backend-spring-plus-python-ai.md)·[0009](decisions/songjeongki/0009-java21-spring-boot-3.md) |
| 인증 | HttpOnly 쿠키 + Redis 세션(엣지) · 미디어=LiveKit JWT | ✅ | [0014](decisions/songjeongki/0014-auth-redis-session-cookie.md) |
| DB | PostgreSQL 16 + pgvector, `core`/`ai` 스키마 분리 | ✅ 둘 다 존재(운영 확인) | [0005](decisions/songjeongki/0005-db-postgres-pgvector.md)·[0017](decisions/songjeongki/0017-schema-ownership-core-ai.md) |
| 캐시·세션 | Redis 7 | ✅ | [0014](decisions/songjeongki/0014-auth-redis-session-cookie.md) |
| 실시간 채널 | STOMP over WebSocket | ✅ | [0019](decisions/songjeongki/0019-ws-realtime-chat-stomp.md) |
| 오브젝트 스토리지 | MinIO(S3 호환) + presigned direct upload | ✅ | [0023](decisions/songjeongki/0023-asset-presigned-upload.md) |
| 미디어 | LiveKit self-host(SFU) + Egress(라이브→HLS) + media-worker(업로드 MP4→HLS) | ✅ 서버·토큰·Egress·라이브 엣지/되감기·VOD 재생·FE 플레이어·녹화강의 UI/API/worker | [0004](decisions/songjeongki/0004-media-livekit-selfhost.md)·[0020](decisions/songjeongki/0020-egress-recording-lifecycle.md)·[0039](decisions/songjeongki/0039-replay-playback-api.md)·[choinhoo/0001](decisions/choinhoo/0001-live-replay-playback-api.md)·[choinhoo/0008](decisions/choinhoo/0008-recorded-lesson-upload-and-hls-transcoding.md) |
| 라이브 STT | realtime-agent (Python, LiveKit Agents) | ✅ GPU 호스트에서 상시 가동 | [0011](decisions/songjeongki/0011-ai-three-services.md)·[0013](decisions/songjeongki/0013-unified-streaming-stt.md) |
| RAG API | ai-api (FastAPI, SSE) | ✅ 운영 가동 | [0011](decisions/songjeongki/0011-ai-three-services.md) |
| 배치 파이프라인 | ai-worker + RabbitMQ | ✅ 운영 가동 | [0011](decisions/songjeongki/0011-ai-three-services.md)·[0012](decisions/songjeongki/0012-hybrid-queue.md) |
| STT/임베딩/LLM | STT·임베딩은 **자체 GPU**(Whisper·bge-m3), LLM은 게이트웨이 경유 | ✅ | [0011](decisions/songjeongki/0011-ai-three-services.md) |
| 관측성 | Micrometer Tracing(Brave) + Prometheus 레지스트리 | ✅ 배선 / 익스포터 ⬜ | — |

> **배포 형태**: 모듈러 모놀리스(Spring 단일 배포) + 폴리글랏 모노레포.
> dev는 FE 8083(Vite proxy) → Spring 8080, prod는 nginx 단일 오리진(§7).

---

## 3. 핵심 원칙

1. **React는 Spring으로만** 업무·AI 요청을 보낸다. Python AI는 외부에 노출되지 않는다 — 권한·정책·비용을 Spring이 검증한다.
2. **`core`(Spring) / `ai`(Python) 스키마 공동수정 금지.** 한 클러스터, 스키마·계정·마이그레이션 도구 분리. 소유 기준은 **write-owner**([ADR-0017](decisions/songjeongki/0017-schema-ownership-core-ai.md)).
3. **긴 작업은 큐 잡으로**, HTTP 요청 안에서 처리하지 않는다. Redis는 durable 큐로 쓰지 않는다(cache/session/fast-path 전용).
4. **미디어 바이트는 Spring과 AI API의 HTTP 요청을 통과하지 않는다.** 강사 발행은 WebRTC로 LiveKit 직결, 학생 시청(라이브·다시보기·녹화강의)은 HLS로 스토리지 직결([ADR-0032](decisions/songjeongki/0032-media-playback-hls-only.md)). PPTX와 녹화강의 MP4는 presigned URL로 클라이언트→스토리지 직접 PUT하고, media-worker만 변환 작업에서 스토리지의 MP4를 읽어 HLS를 쓴다.
5. **AI 결과는 후보다.** 원본은 보존하고, 강사 수정·게시본을 학생에게 노출한다.
   - **예외 — 라이브 자막.** 실시간 자막은 검수 없이 즉시 나간다(그게 실시간의 본질). 검수는 사후에 게시본을 교정하는 형태이고, 승인 게이트는 두지 않는다([ADR-0017](decisions/songjeongki/0017-schema-ownership-core-ai.md)).
6. **AI 장애가 코어를 막지 않는다.** 라이브 영상·채팅·수강·다시보기는 AI와 무관하게 살아 있어야 한다(degraded). LiveKit/Egress 미디어 경로는 AI와 격리한다.

---

## 4. 시스템 구성도

```mermaid
flowchart LR
  classDef built fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef partial fill:#fef9c3,stroke:#ca8a04,color:#713f12
  classDef planned fill:#f8fafc,stroke:#94a3b8,color:#475569,stroke-dasharray:4 3

  FE["React 19 + TS<br/>LiveKit client(강사 발행) · HLS.js(재생) · WS"]

  subgraph CTRL["컨트롤·데이터 — Spring Boot 4.1 (모듈러 모놀리스)"]
    SP["core-api<br/>인증·커리큘럼·수강·라이브·채팅·자산<br/>LiveKit 토큰 · Egress 제어 · AI 게이트웨이"]
    PG[("PostgreSQL 16 + pgvector<br/>core / ai 스키마")]
    RD[("Redis 7<br/>session·cache · STT 스트림")]
    MQ[["RabbitMQ<br/>ingestion · media.transcode"]]
  end

  subgraph AI["Intelligence — Python"]
    AG["realtime-agent<br/>라이브 STT"]
    API["ai-api (FastAPI)<br/>RAG SSE · 용어 설명"]
    WK["ai-worker<br/>PPTX·chunk·embed·후보"]
    GW["model gateway → STT/embed/LLM"]
  end

  subgraph MEDIA["미디어 — LiveKit + 업로드 변환"]
    LK["LiveKit SFU"]
    EG["Egress 녹화 → HLS"]
    MW["media-worker<br/>ffprobe · FFmpeg"]
    OBJ[("MinIO / S3")]
  end

  FE -->|"REST · WS(STOMP)"| SP
  FE -->|"WebRTC 발행(강사)"| LK
  FE -->|"presigned PUT (자료 · MP4)"| OBJ
  FE -.->|"HLS 재생"| OBJ
  SP -->|"토큰 · Egress 제어"| LK
  SP --- PG
  SP --- RD
  SP -.->|"잡 발행 (outbox)"| MQ
  SP -.->|"internal 검증된 scope"| API
  MQ -.-> WK
  MQ --> MW
  WK -.->|"완료 이벤트"| MQ
  MQ -.->|"inbox 멱등 수신"| SP
  LK -.->|"강사 오디오"| AG
  AG -.->|"caption 스트림"| RD
  RD -.->|"consume → core 영속"| SP
  LK -->|"녹화"| EG
  EG --> OBJ
  OBJ -->|"MP4 source GET"| MW
  MW -->|"업로드 MP4 → HLS"| OBJ
  API -.-> PG
  API -.-> GW
  WK -.-> GW
  WK -.-> PG

  class FE,SP,PG,RD,MQ,LK,EG,OBJ built
  class MW partial
  class AG,API,WK,GW planned
```

**실선 = 구현됨, 점선 = 설계(CP2~CP4).**
녹화강의 경로는 코드가 배선됐고 실제 MinIO·RabbitMQ·FFmpeg 통합 검증이 남아 부분 구현으로 표시한다.
미디어·자료 바이트가 Spring을 통과하지 않는다는 원칙 4가 화살표에 그대로 드러난다 — `FE→OBJ`, `FE→LK`, `EG→OBJ`, `MW→OBJ`는 모두 Spring을 우회한다.

---

## 5. 백엔드 모듈 구조 (구현 기준)

Spring Modulith로 **모듈 경계를 코드로 강제**한다. 이게 이 코드베이스에서 가장 강하게 지켜지는 규칙이다.

```mermaid
flowchart TB
  classDef built fill:#dcfce7,stroke:#16a34a,color:#14532d
  classDef stub fill:#f8fafc,stroke:#94a3b8,color:#475569,stroke-dasharray:4 3

  CUR["curriculum<br/>카탈로그·구조·발행"]
  ENR["enrollment<br/>수강 신청·승인·로스터"]
  LIV["live<br/>세션·토큰·채팅(WS)"]
  VID["video<br/>Egress 제어·녹화물"]
  LES["lesson<br/>레슨·자료"]
  AST["asset<br/>presigned 업로드"]
  AUTH["auth<br/>계정·세션·프로필"]
  LRN["learning<br/>진도·학습 접근"]
  AIX["aiintegration<br/>outbox 릴레이·RAG 프록시"]
  NOT["notification<br/>알림 팬아웃·실시간·Web Push"]
  CMN["common<br/>예외·로깅·설정"]

  CUR --> LES
  CUR --> ENR
  CUR --> VID
  CUR --> AUTH
  CUR --> AST
  CUR --> LRN
  CUR --> AIX
  LIV --> ENR
  LIV --> AUTH
  LIV --> AIX
  LIV --> AST
  VID --> LIV
  LES --> AST
  AIX --> LES
  AIX --> AST
  NOT --> CUR
  NOT --> ENR
  NOT --> LES
  NOT --> LIV
  NOT --> VID
  NOT --> AUTH
  NOT --> AIX

  class CUR,ENR,LIV,VID,LES,AST,AUTH,LRN,AIX,NOT,CMN built
```

**`notification`은 아무도 참조하지 않는다.** 화살표가 전부 나가기만 한다 — 통째로 들어내도 나머지
모듈은 컴파일된다. 알림처럼 나중에 붙는 기능이 다른 모듈을 오염시키지 않았다는 증거이고,
`ModularityTests`가 이 방향을 계속 지킨다.

**규칙**
- 모듈 간 접근은 **`<module>.api` 패키지(`@NamedInterface("api")`)로만.** 남의 `domain`·`repository`를 직접 부를 수 없다.
- 포트는 읽기/쓰기로 나눈다 — `XxxDirectory`(조회) / `XxxManagement`(변경). 경계를 넘는 값은 전부 record DTO.
- **순환 금지.** `ModularityTests`가 CI에서 검증하므로 위반은 리뷰가 아니라 **빌드 실패**로 잡힌다.
- 포트는 **필요해질 때** 만든다. 지금은 `common`을 뺀 **10개 모듈 전부** `.api`를 갖는다 —
  `curriculum`이 마지막이었고, 알림이 "이 커리큘럼이 아직 있는가"를 물어야 해서 생겼다
  ([ADR-0073](decisions/songjeongki/0073-notification-fanout-architecture.md)).

**이 게이트가 실제로 잡은 것**
- `video → live.config` 결합 — 아무도 의도하지 않은 결합이 드러나 `live/api/LiveKitServerAccess` seam으로 정리
- `CatalogService`가 web DTO를 알던 계층 역전 — 서비스 레벨 record + web `from()` 팩토리로 분리
- `live → curriculum` 순환 차단 → `live_session.curriculum_id` 비정규화(V2). 제약이 없었으면 리포지토리를 그냥 주입했을 것이고, 결과적으로 **조인 없이 수강 게이팅되는 더 빠른 구조**가 됐다

**한때 스캐폴딩이던 둘은 배선이 끝났다**([ADR-0024](decisions/songjeongki/0024-orphan-module-scaffolding.md)).
`learning`은 진도·학습 접근 판정으로, `aiintegration`은 outbox 릴레이와 RAG 프록시로 실제 경로에 들어갔다.
아웃박스는 원래 AI 배치 잡 발행용이었는데 알림이 일반화해 함께 쓴다 — 목적지가 코드가 아니라
**데이터**가 되면서 두 종류의 잡이 한 릴레이를 지나간다.

---

## 6. 데이터플로우

### 6-1. 라이브 강의 ✅

```mermaid
sequenceDiagram
  actor T as 강사
  actor S as 학생
  participant SP as Spring
  participant LK as LiveKit(+Egress)
  participant OBJ as MinIO/S3(HLS)
  participant AG as realtime-agent
  participant RD as Redis Stream
  T->>SP: 세션 시작
  SP->>SP: 권한 확인 → 세션 상태 전이(OPEN→LIVE)
  SP->>LK: 방 토큰 발급 + Egress 녹화 시작
  T->>LK: 오디오·영상 (WebRTC 발행)
  LK->>OBJ: Egress가 HLS 세그먼트·live.m3u8 지속 기록
  S->>SP: 라이브 재생 요청 (수강 확인)
  SP-->>S: live.m3u8 URL (라이브 엣지)
  S->>OBJ: HLS 재생 (라이브 엣지 — WebRTC 구독 아님, ADR-0032)
  Note over T,S: 발행·Egress·토큰·학생 시청·자막까지 운영에서 동작한다
  LK-->>AG: 강사 오디오 (방당 1회)
  AG-->>AG: 스트리밍 STT (VAD, partial/final)
  AG-->>RD: caption 스트림
  RD-->>SP: consume → core 영속
  SP-->>S: WS 자막 (지평선 뒤 교정본)
  Note over LK,SP: AI가 죽어도 영상·채팅은 유지 (원칙 6)
```

> **학생은 LiveKit 방에 참가하지 않는다**(HLS 단일 시청, [0032](decisions/songjeongki/0032-media-playback-hls-only.md)) — 참가자 목록 유출 자체가 없다. 예전엔 이를 막으려 `(sessionId, userId)` 해시 identity를 썼고, 가명화는 이제 채팅 계층에서 이어진다.

### 6-2. RAG 질문 ✅

```mermaid
sequenceDiagram
  actor S as 학생(FE)
  participant SP as Spring
  participant API as ai-api
  participant PG as pgvector
  participant GW as model gateway
  S->>SP: 질문 + lessonId + 현재시각 + 난이도
  SP->>SP: 인증 · 수강 · AI 정책 · 비용 한도
  SP->>API: internal (검증된 scope)
  API->>PG: FTS + vector 검색, scope 필터, RRF 융합
  PG-->>API: 근거 후보 (자료 · 자막)
  API->>GW: 프롬프트 + 근거
  GW-->>API: 구조화 답변 + citation
  API-->>SP: SSE 토큰 스트림
  SP-->>S: SSE 중계 (근거 없으면 INSUFFICIENT_EVIDENCE)
```

**핵심 안전장치**: 근거가 없으면 답을 지어내지 않고 `INSUFFICIENT_EVIDENCE`를 반환한다. 모든 답변에 citation을 붙인다.

### 6-3. RAG ingestion ✅

```mermaid
flowchart LR
  ST["라이브 자막<br/>core"] --> CH["chunk"]
  M["강사 PPTX 업로드<br/>presigned → MinIO"] --> MP["ai-worker: 파싱"]
  MP --> CH
  CH --> EM["embedding → ai.chunk_embedding"]
  EM --> CAND["용어·노트·퀴즈 후보"]
  CAND -->|"완료 이벤트 → inbox"| CORE["Spring이 core에 기록"]
  CORE --> REV["강사 검수·게시"]
```

잡은 **idempotency key + outbox**로 유실·중복을 막고, 실패는 **DLQ**로 보낸다.
Python은 `core`에 직접 쓰지 않는다 — 결과는 큐 이벤트로 돌아오고 Spring이 기록한다([ADR-0017](decisions/songjeongki/0017-schema-ownership-core-ai.md)).

### 6-4. 녹화 → 다시보기 ✅

```mermaid
flowchart LR
  L["라이브 세션"] -->|"✅ Egress 제어"| EG["녹화 → HLS → MinIO"]
  L --> DB["자막·용어·근거 영속"]
  EG -->|"✅ VideoAsset 상태 추적"| VA["STARTING→…→READY"]
  VA -->|"✅ READY+PUBLISHED 자동 확정"| PUB["영상 다시보기 자동 게시"]
  PUB -->|"✅ 재생 API"| RP["다시보기 플레이어"]
  DB --> RP
  RP --> DONE["교정 자막 · 용어 호버 · 저장 컨텍스트 Q&A"]
```

**지금 되는 것**: 세션 시작·종료 이벤트로 Egress를 제어하고, `VideoAsset`이 녹화 수명주기를 추적하며, 카탈로그가 "다시보기 있음"을 표시한다. **재생 metadata API**(`GET /lessons/{id}/playback`)가 source와 시간축을 반환하고, **manifest API**(`GET .../playback/manifest`)가 권한을 재검증한 뒤 세그먼트 URI를 presigned로 재작성한다([ADR-0039](decisions/songjeongki/0039-replay-playback-api.md), [ADR-0001](decisions/choinhoo/0001-live-replay-playback-api.md)). 라이브 중에는 **델타 재생목록**(`CAN-SKIP-UNTIL` 광고 → `_HLS_skip=YES` → `EXT-X-SKIP`)으로 갱신 크기를 잡는다 — 진행 바는 강의 전체를 유지하면서 폴링 비용만 줄인다. **수동 게시·철회 API**(`POST .../replay-review/publish`, `POST .../replay-review/withdraw`)도 구현되어 있으며, 수동 게이트는 기존 미게시 자산과 철회 후 재게시를 위해 유지한다.
**구현된 종료·자동 게시 흐름([ADR-0007](decisions/choinhoo/0007-recording-ready-auto-publish-and-processing-polling.md))**: 종료 API는 `ENDING` 선커밋 → Room 삭제 → `VideoAsset FINALIZING` 선커밋 → 실패 허용 `StopEgress` 안전장치 → `ENDED` 순서로 끝난다. LiveKit `egress_ended(EGRESS_COMPLETE)` webhook이 manifest를 검증하면 같은 DB 트랜잭션에서 `VideoAsset READY + ReplayStatus PUBLISHED`를 확정한다. 강사 FE는 종료 성공 뒤 처리 화면에서 DB snapshot API를 2초 간격(30초 뒤 5초)으로 폴링하고, `READY + PUBLISHED`에서 replay 화면으로 자동 이동한다. 이 완료 알림 용도로 새 WebSocket은 추가하지 않는다.
**남은 것**: Egress 지연 실측, 검수 데이터 저장([0039](decisions/songjeongki/0039-replay-playback-api.md) §5 범위 제외 근거).
자막·용어·RAG 재생은 배선이 끝났다.

다시보기는 라이브 때 만든 산출물을 **그대로 재생**한다. 지평선 뒤라 이미 교정이 끝난 상태이고, 세션 상대 ms 좌표로 HLS와 자막을 자동 정렬한다.

### 6-5. 업로드 녹화강의 🟡 (UI·API·worker ✅ / 운영 E2E·학습 플레이어 연결 ⬜)

```mermaid
flowchart LR
  FE["강사 업로드 화면"] -->|"녹화강의 생성·티켓 발급"| API["Spring recorded API"]
  API -->|"presigned PUT URL"| FE
  FE -->|"MP4 직접 PUT"| OBJ[("MinIO / S3")]
  API -->|"job commit"| DB[("recorded_video<br/>media_transcode_job")]
  DB -->|"dispatcher"| MQ[["media.transcode"]]
  MQ --> WK["media-worker<br/>ffprobe · FFmpeg"]
  WK -->|"HLS segment 후 manifest"| OBJ
  WK -->|"서명 callback"| API
  API -->|"manifest·segment 검증 후 READY"| PLAY["녹화강의 HLS 재생 API"]
```

`lesson.delivery_type`은 `LIVE|RECORDED`이고 생성 후 바뀌지 않는다. 녹화강의는
`recorded_video`와 시도별 `media_transcode_job`을 사용하며 기존 `live_session`, `video_asset`,
LiveKit webhook을 건드리지 않는다. React는 생성→원본 티켓→스토리지 PUT→완료 접수 순서로 호출한다.
Spring은 접수 트랜잭션과 분리된 dispatcher로 durable queue에 발행하며, worker callback을 기존
`external_event_inbox`로 멱등 처리한다. 최종 manifest와 첫 segment가 확인된 뒤에만 `READY`가 된다.

---

## 7. 도메인 모델

소유 기준은 **write-owner** — 런타임에 그 행을 쓰는 서비스가 소유한다([ADR-0017](decisions/songjeongki/0017-schema-ownership-core-ai.md)).

### `core` — Spring 단독 쓰기

| 영역 | 테이블 | 상태 |
|---|---|---|
| 계정 | `app_user` · `instructor_profile` | ✅ |
| 강좌 | `curriculum` → `section` → `lesson` | ✅ |
| 라이브 | `live_session` | ✅ |
| 수강·학습 | `enrollment` · `learning_progress` · `bookmark` | ✅ 전부 배선 |
| 자산 | `asset`(범용) ← `material_asset`(레슨 자료) · `video_asset`(라이브 녹화 HLS) · `recorded_video`/`media_transcode_job`(업로드 MP4·HLS) | ✅ 전부 배선 |
| 채팅 | `chat_message` | ✅ |
| 통합 | `outbox_events`(목적지별 릴레이) · `external_event_inbox` | ✅ 배선 |
| AI 게시본 | 자막 · 용어 · 강의 노트 | ✅ / 챕터·퀴즈 ⬜ |

### `ai` — Python 단독 쓰기 ✅ (Alembic: `ai/ai-worker/migrations`, 운영에 표 6개)

`document_chunk` · `chunk_embedding`(RAG 인덱스) · `job_run` · `model_run`(실행 메타) — **이 4개뿐**이다.

> ⚠️ 이전 판 문서는 `ai`에 자막 원본·후보·질의응답까지 올려놨었는데, [ADR-0017](decisions/songjeongki/0017-schema-ownership-core-ai.md)이 이를 정리했다.
> **원본 자막의 write-owner는 Spring이다** — realtime-agent는 Redis 스트림에 흘리기만 하고, 영속은 Spring이 한다.
> 따라서 자막은 원본·게시본 모두 `core`에 있고, Python은 chunking을 위해 **읽기만** 한다.

### 구조 규칙

- **FK는 스키마 안에서만.** 스키마를 넘는 참조는 물리 FK 없이 논리 `_ref` 컬럼 + 앱 검증.
- **PK는 UUID/BIGINT 하이브리드**([ADR-0018](decisions/songjeongki/0018-pk-strategy-uuid-bigint-hybrid.md)) — 외부 노출은 UUID, 대량 append-only는 BIGINT.
- **시간축은 세션 상대 ms** — 자막·HLS·다시보기 정렬의 공통 좌표.
- **마이그레이션 주체**: `core` = Flyway(Spring, 현재 V1~V20), `ai` = Alembic(Python). 상대 스키마 수정 금지.
- **보류**: org/멀티테넌트 · roles 테이블 · audit_logs · learning_events · question_clusters.

---

## 8. 배포 토폴로지 ✅

단일 EC2(Ubuntu 24.04, 4vCPU/15GB)에 **두 스택이 독립적으로** 돈다.

```mermaid
flowchart TB
  classDef built fill:#dcfce7,stroke:#16a34a,color:#14532d

  NET(["인터넷"])

  subgraph APP["앱 스택 — docker-compose.prod.yml"]
    NGX["nginx (443 TLS 종단)<br/>/ → SPA · /api → backend"]
    BE["backend :8080"]
    PGC[("postgres")]
    RDC[("redis")]
    CB["certbot 갱신 루프"]
  end

  subgraph MED["미디어 스택 — infra/livekit (network_mode: host)"]
    NGL["nginx-livekit :7443 WSS (되는 망 지름길)"]
    LKC["livekit :7880 · UDP 3478"]
    EGC["egress"]
    MIO[("minio")]
    RDL[("redis (미디어 전용)")]
  end

  NET -->|":80 → 301"| NGX
  NET -->|":443"| NGX
  NET -->|":443 /livekit 시그널링(정본)"| NGX
  NET -->|":7443 시그널링(대체)"| NGL
  NET -->|":3478/udp 미디어"| LKC
  NGX --> BE
  NGX -->|"/livekit → :7880"| LKC
  BE --- PGC
  BE --- RDC
  NGL --> LKC
  LKC --- RDL
  EGC --- RDL
  EGC --> MIO
  CB -.->|"인증서 볼륨 공유"| NGL

  class NGX,BE,PGC,RDC,CB,NGL,LKC,EGC,MIO,RDL built
```

**설계 포인트**
- **단일 오리진.** nginx가 SPA와 `/api`를 같은 오리진에서 서빙해 쿠키 세션이 CORS 없이 동작한다. FE의 `baseURL`은 `/api` 상대경로다([ADR-0016](decisions/songjeongki/0016-drop-api-path-versioning.md) 경로 버저닝 제거).
- **DB·Redis는 호스트 포트를 열지 않는다.** 도커 내부 네트워크 전용 + Security Group 차단, 2중 방어.
- **도메인이 하나뿐이고 DNS 콘솔 권한이 없어** 미디어 시그널링을 서브도메인이 아니라 **같은 도메인의 별도 TLS 포트(`:7443`)** 로 분리했다([ADR-0022](decisions/songjeongki/0022-local-vs-ec2-infra-profile.md)). 인증서는 앱 스택 certbot이 단독 발급·갱신하고 미디어 nginx는 볼륨으로 읽기만 한다.
- **미디어 스택은 `network_mode: host`** — SFU가 UDP 포트 범위를 직접 잡아야 해서 도커 NAT를 우회한다.
- 배포는 GitLab CI/CD self-hosted runner가 EC2에서 직접 수행한다.

---

## 9. 미해결 설계 이슈 — 착수 전 결정 필요

미구현 영역을 점검하며 나온 것들이다. 대부분 **CP2 착수 전에 답이 있어야** 한다.

### 9-1. 🔴 "지평선(horizon)"이 정의되지 않았다
제품 설명의 핵심 단어인데 정의가 없다. 라이브 시청자가 보는 시점과 확정본 사이의 지연을 뜻하는데, **몇 초인지·누가 확정하는지**가 없으면 FE는 자막 렌더링 정책을, BE는 영속 시점을 정할 수 없다.
→ **제안**: partial은 즉시 렌더(회색), final은 확정 렌더, 교정·용어·근거는 `t - N초` 뒤 재전송. `N`은 CP2 STT bake-off 결과로 확정하고 설정값으로 뺀다. 다시보기는 정의상 항상 지평선 밖이라 전체 기능이 나간다.

### 9-2. ✅ 해소됨 — 자료→레슨 연결
`POST /instructor/lessons/{lessonId}/materials`로 미리 올린 PPTX 에셋(`kind=MATERIAL`)을 레슨에 연결한다. 본문은 presigned 티켓 방식(`{"assetId":"..."}`, multipart 아님), `material_asset`에 status=ACTIVE로 저장되고 레슨/커리큘럼 상세의 `materials`가 이 레코드로 채워진다. 상세는 [ADR-0035](decisions/songjeongki/0035-lesson-material-attach.md).
커리큘럼-레벨 자료·삭제 API·AI(RAG ingestion) 잡 발행은 CP3으로 유보한다 — 이 연결이 그 입력이 된다.

### 9-3. 🟠 Redis Streams가 원칙 3과 긴장 관계다
원칙 3은 "Redis를 durable 큐로 쓰지 않는다"인데, STT 자막이 Redis Streams를 지난다. Redis가 재시작하면 그 구간 자막의 정본이 없다.
→ **제안**: 자막 fast-path는 **의도적으로 유실 허용**(consumer group + PEL로 at-least-once까지만)하고, 유실 구간은 **CP4 녹화본 2-pass 재처리로 복구**한다. 이러면 원칙 3과 모순되지 않는다 — Redis는 여전히 fast-path이고 정본 복구 경로는 녹화다. 이 문장을 계약에 명시해야 한다.

### 9-4. ✅ 해소됨 — RabbitMQ 배선(자료 임베딩 잡)
backend에 `spring-amqp` 의존성·설정이 들어가고, `outbox_events`를 읽어 `ingestion.embed`로 발행하는 **outbox 릴레이**가 붙었다. prod compose에도 RabbitMQ 컨테이너가 추가됐다([ADR-0036](decisions/songjeongki/0036-material-embedding-pipeline.md)). 자료 임베딩 파이프라인은 스위치(`material.embedding.enabled`) 뒤에서 기본 off다.
> **채팅 브로커(STOMP relay) 전환은 여전히 미착수다(§9-6).** 여기서 붙은 건 배치 잡용 AMQP 경로이지, 인메모리 STOMP SimpleBroker를 RabbitMQ relay로 바꾸는 작업은 아니다 — 그건 수평 확장 시점에 별도로 한다.

### 9-5. 🔴 EC2 단일 노드 용량이 CP2부터 빠듯하다
두 스택 합쳐 이미 컨테이너 10여 개가 돌고, Egress는 내부적으로 Chrome을 띄워 **단독 권장 사양이 4vCPU/4GB**다. 여기에 CP2~CP3에서 realtime-agent·ai-api·ai-worker·RabbitMQ가 더 붙는다.
→ **완화 전제를 명시해야 한다**: ① STT·임베딩·LLM은 전부 **외부 API**(로컬 모델 미탑재), ② Egress는 데모 세션에만 기동, ③ 동시 라이브 세션은 데모 규모(1~2개)로 전제. 이 전제가 깨지면 노드 분리가 필요하다.

### 9-6. 🟠 채팅 WS가 수평 확장의 첫 장애물이다
STOMP 브로커가 인메모리 SimpleBroker라 **브로드캐스트가 인스턴스 로컬**이다. backend를 2대로 늘리는 순간 채팅이 인스턴스별로 갈린다.
→ 세션이 Redis에 있어 나머지는 이미 stateless이므로, **수평 확장의 유일한 선행조건이 브로커 교체**다. CP3에서 RabbitMQ를 들일 때 STOMP relay로 함께 전환하는 게 자연스럽다.

### 9-7. 🟡 Python → Spring 역방향 경로 — 자료 임베딩은 콜백 inbox로 구현됨
`external_event_inbox`(멱등 수신)를 쓰는 **AI 콜백 수신기가 배선됐다** — 워커가 `POST /api/internal/ai/callbacks`(HMAC 서명, permitAll이되 서명이 실질 인증)로 보내면 `(source=ai-worker, eventId)` 복합키로 멱등 처리해 자료 embeddingStatus를 확정한다([ADR-0036](decisions/songjeongki/0036-material-embedding-pipeline.md), CONTRACT §3-2).
→ 다만 **STT/자막 실시간 역방향(Redis Streams 소비→core 영속)은 여전히 미결**이다. ADR-0017이 상정한 "결과 큐" 경로 중 배치 잡 콜백만 섰고, 실시간 경로는 CP2에서 붙는다.

### 9-8. ✅ 다시보기 재생 인증 — presigned 방식으로 구현됨
이전 판은 "seam 3개(재생 URL 발급 · nginx · PlaybackTokenService)"라고 적었지만, 실제로는 **셋 다 존재하지 않고**, 현재 nginx는 SPA·API 프록시 전용이라 HLS 서빙 경로 자체가 없었다.
→ **구현 완료(2026-07-28, [ADR-0039](decisions/songjeongki/0039-replay-playback-api.md), [ADR-0001](decisions/choinhoo/0001-live-replay-playback-api.md))**: nginx secure_link 대신 **presigned 방식으로 통일**했다. `GET /api/lessons/{id}/playback`은 권한을 검증하고 metadata만 반환하며, `GET .../playback/manifest`가 권한을 다시 검증해 manifest의 일반 URI와 MAP/KEY URI를 presigned URL로 재작성한다. 소유 강사는 항상, 학생은 활성 수강·게시 레슨이 필수다. 학생은 라이브 중 replay 게시 상태와 무관하게 시청하고 종료 후에는 PUBLISHED만 본다.

**세그먼트 서빙 경로**: nginx `location /recordings/`가 MinIO로 프록시하되 **Host를 보존**한다 — presigned URL이 공개 도메인으로 서명돼 있고 SigV4가 Host를 서명에 포함하기 때문이다(`/liveclass-assets/`와 같은 규칙). 그래서 주소가 둘로 갈린다: backend가 매니페스트를 읽는 내부 주소(`livekit.egress.s3-endpoint`)와 브라우저용 서명 주소(`video.playback.public-endpoint`). SPA와 same-origin이라 CORS는 발생하지 않는다.

**manifest 크기**: 라이브 재생목록은 세션이 길어질수록 자라고 플레이어가 targetDuration마다 다시 받으므로, 그대로 두면 2시간 시점에 갱신 하나가 MB 단위가 된다. 델타 재생목록(§9-10)으로 잡는다. 세그먼트는 스토리지 직결이라 원칙 4를 유지하며 S3로 옮겨도 그대로 동작한다.

### 9-9. ✅ 다시보기 시간축 변환 — 온디맨드 계산으로 구현됨
자막 싱크는 전송 경로가 아니라 **공통 좌표계** 문제다. 세그먼트는 스토리지에서 직접 받고 자막은 Spring이 내려주므로, 둘을 맞추려면 *재생 위치 → 세션 상대 ms* 변환이 필요하다.

**조사 결과**(Egress v1.13.0 소스 확인)
- Egress는 **모든 세그먼트에 `EXT-X-PROGRAM-DATE-TIME`을 넣는다.** 옵션으로 끌 수 없고 API에도 관련 필드가 없다.
- 다만 **PDT 델타는 `EXTINF` 누적합과 수학적으로 같다.** 즉 PDT가 추가로 주는 정보는 **첫 세그먼트의 절대 시각(앵커) 하나뿐**이다. 프론트가 PDT를 직접 읽어도 얻는 게 없고, hls.js 종속만 생긴다(Safari 네이티브 재생 경로에는 PDT 접근 API가 없다).
- **`EXT-X-DISCONTINUITY`는 생성하지 않는다.**

**결정 — 단일 오프셋, 앵커는 첫 PDT에서 뽑는다**
```
session_offset_ms = index.m3u8 의 첫 PROGRAM-DATE-TIME − live_session.started_at
자막 위치(ms)      = player.currentTime * 1000 + session_offset_ms
```
서버가 앵커를 한 번 읽어 **숫자 하나로 환산해 내려주고**, 프론트는 그 숫자만 쓴다. 플레이어 선택이 묶이지 않는다.

> ⚠️ **`video_asset.recording_started_at`을 앵커로 쓰면 안 된다.** 지금 값은 `StartEgress` 호출 시각(`RecordingService`)이라, Chrome 기동·페이지 로드·방 접속 지연이 통째로 오차가 된다 — `infra/livekit/README.md` 트러블슈팅에 20초까지 걸린 사례가 있다.

**구현 완료(2026-07-28, [ADR-0039](decisions/songjeongki/0039-replay-playback-api.md), [ADR-0001](decisions/choinhoo/0001-live-replay-playback-api.md))** — 앵커를 별도 컬럼에 저장하는 대신, metadata 요청마다 **온디맨드로 계산**한다. `GET /lessons/{id}/playback`이 재생 범위를 계산하려고 읽은 매니페스트에서 첫 PDT를 파싱해 `live_session.started_at`(`recording_started_at`이 아니다)과의 차이를 `sessionOffsetMs`로 응답에 싣는다. `video_asset.session_offset_ms` 컬럼은 유지하되 쓰지 않는다. PDT가 없으면 `null`로 degrade하고 EXTINF 합계로 재생 가능 범위를 계산한다. 재생목록은 **첫 세그먼트가 닫히는 즉시**(세그먼트 2초 설정) 업로드되므로 녹화 종료를 기다릴 필요가 없다.

**남은 위험 — 파이프라인 stall(미검증).** 미디어 타임라인이 벽시계 대비 멈추면 그만큼 자막이 누적해서 어긋나는데, `DISCONTINUITY` 태그가 없어 **사후 탐지 수단이 없다.** 반면 egress 재시작은 위험하지 않다 — 파일 접두사에 `{retry}` 치환자가 없어 재시도 자체가 거부되므로, 같은 재생목록에 두 번째 타임라인이 몰래 이어붙지 않는다(뒤가 잘릴 뿐 오프셋은 유효).

**실측 과제**: EC2에서 한 세션 돌려 `첫 PDT − recording_started_at` 차이를 재 둔다. 그 값이 곧 "앵커를 바꿔야 하는 이유"의 정량 근거다.

### 9-10. ✅ 라이브 재생목록 무한 성장 — 델타 재생목록으로 해결

HLS 재생목록은 **"지금 존재하는 세그먼트 전체 목록"** 이고, 라이브 중에는 플레이어가 이를 targetDuration 주기로 다시 받는다. 세그먼트 2초 설정에서 2시간 강의면 3600엔트리이고, presigned 재작성 후 엔트리당 300바이트를 넘어 **갱신 하나가 1MB를 넘는다. 그걸 2초마다 시청자 수만큼** 내보내게 된다.

**잘라 보내는 것은 답이 아니다.** 짧은 재생목록은 플레이어에게 "나머지는 사라졌다"는 뜻이라 진행 바가 윈도우 크기로 쪼그라든다. 라이브 중 강의 처음으로 되감기가 불가능해진다.

→ **델타 재생목록**(RFC 8216bis §6.2.5.1). `#EXT-X-SKIP:SKIPPED-SEGMENTS=N`은 "생략했을 뿐이니 갖고 있는 것과 병합하라"는 신호다. 그래서 `EXT-X-MEDIA-SEQUENCE`도 건드리지 않는다 — 재생목록의 논리적 시작점은 그대로고 **진행 바는 강의 전체를 유지한다.**

```
최초    GET .../playback/manifest
        ← 전체 + #EXT-X-SERVER-CONTROL:CAN-SKIP-UNTIL=60   (능력 광고)
갱신    GET .../playback/manifest?_HLS_skip=YES            (플레이어가 자동으로 붙임)
        ← 최근 60초분 + #EXT-X-SKIP:SKIPPED-SEGMENTS=3570
```

협상은 클라이언트가 주도하므로 **서버는 클라이언트별 상태를 들지 않는다.** `hls.js` 1.6.16이 기본 설정으로 이 협상을 수행한다(`getSkipValue` → `_HLS_skip`, `SKIPPED-SEGMENTS` 병합, 델타 병합 실패 시 전체 재요청 폴백). 생략을 먼저 하고 presign을 하므로 **남은 세그먼트만 서명한다** — 서버 CPU도 같이 잡힌다.

종료 후 재생목록은 `#EXT-X-ENDLIST`가 붙어 플레이어가 다시 받지 않으므로 델타를 쓰지 않는다. 전체를 한 번 내보내고 끝이다.

> ⚠️ **`segment-url-ttl`이 강의 길이보다 길어야 한다(기본 6h).** 델타는 옛 세그먼트의 presigned URL을 다시 주지 않는다 — 클라이언트가 최초 로드 때 받은 것이 전부다. TTL이 짧으면 오래 시청한 학생이 앞으로 되감을 때 403을 맞는다.

**미검증**: 실제 Egress 출력으로 델타 병합을 확인하지 않았다. LiveKit이 라이브 중 내는 `index.m3u8`의 태그 구성(`EXT-X-VERSION` 값, PDT 주기)에 따라 조정이 필요할 수 있다.

### 9-11. ✅ `ai` 스키마와 Alembic — 세워졌다
`ai/ai-worker/migrations`가 Alembic으로 관리하고, 운영 `ai` 스키마에 표 6개가 있다.
**남은 것은 DB 롤 분리**(`core_app`/`ai_app`)다 — 지금은 스키마만 나뉘어 있고 계정이 같아,
원칙 2("스키마 소유권")가 관례로만 지켜진다.

### 9-12. 🟡 남은 프론트 임시 API 경로를 계약화해야 한다
FE는 **오퍼레이션 단위 하이브리드 라우팅**을 쓴다 — 각 호출에 `apiImplemented` 플래그가 붙어 구현된 API는 실 HTTP로, 미구현은 목으로 간다([ADR-0027](decisions/songjeongki/0027-frontend-incremental-api-cutover.md)). 현재 인증·커리큘럼·레슨·라이브 세션에서 **28개 오퍼레이션이 실 연동**됐다(세션 시작/종료·토큰·참가자·채팅 포함).

`/instructor/live-sessions/{id}/processing`은 [ADR-0007](decisions/choinhoo/0007-recording-ready-auto-publish-and-processing-polling.md)과
`CONTRACT.md` §2-3의 계약대로 FE adapter와 backend endpoint가 구현됐다.
`/instructor/lessons/{id}/ai-preparation` 등 나머지 임시 경로는 구현 전에 계약으로 승격하거나 FE 코드에
임시 경로임을 계속 명시해야 한다.

> ✅ 이전에 충돌하던 자료 업로드 경로는 해소됐다. FE가 `POST /instructor/lessons/{id}/materials`를 **presigned 티켓 흐름**(에셋 업로드 후 `{"assetId":"..."}` 연결, multipart 아님)으로 배선해 원칙 4·[ADR-0023](decisions/songjeongki/0023-asset-presigned-upload.md)·[ADR-0035](decisions/songjeongki/0035-lesson-material-attach.md)와 일치한다.

`livekit-client`·`hls.js` 의존성은 아직 없다 — **CP1 데모의 실제 잔여 작업은 FE 미디어 연동 하나**다.

---

## 10. 구현 현황 요약

> 이 표는 **코드베이스를 직접 훑어** 맞춘 것이다(2026-08-04). 예전 표가 자막·RAG를 미구현으로
> 적어 둔 채 오래 방치돼, 실제로 돌아가는 기능을 "안 했다"고 말하고 있었다.

| CP | 범위 | 상태 | 근거 |
|---|---|---|---|
| **T0** | 인프라·배포 | ✅ | compose·CI·Flyway(V1~V29)·EC2 자동 배포(master 머지 → `docker compose up --wait`) |
| **CP0** | 인증 + 강좌 골격 | ✅ | 로그인·커리큘럼·섹션·레슨·수강·카탈로그. FE 실 API 연동 |
| **CP1** | 라이브 미디어 | ✅ | LiveKit 자체 호스팅, 토큰·방 제어·Egress, 채팅 WS, 세션 수명주기. FE 미디어 클라이언트 포함 |
| **CP2** | 라이브 자막 | ✅ | realtime-agent(GPU 호스트) → Redis Streams → 소비자 → WS. 세그먼트 앵커·위치 동기화 |
| **CP3** | 용어·근거 RAG | ✅ | ai-api·ai-worker·bge-runtime. 자료 임베딩, 근거 기반 Q&A(SSE), 용어집, 대화 메모리 |
| **CP4** | 녹화·다시보기 | ✅ | Egress → HLS, 자동/수동 게시, 재생 API, 많이 본 구간 히트맵 |
| **CP5** | 퀴즈 | ⬜ | 서버에 도메인 없음. FE 어댑터가 501을 던진다 |
| **(추가)** | 판서 | ✅ | Excalidraw 판서 + **AI 의미 해석**(좌표 동기화가 아님) |
| **(추가)** | 강의 노트 | ✅ | 발화 누적 기반 마크다운 노트 생성·정제 |
| **(추가)** | 알림 센터 | ✅ | 12종 중 11종 발행, 조회 5경로, STOMP 실시간 + Web Push |

**로드맵 밖에서 자란 것이 셋**이다(판서·강의 노트·알림). CP 번호는 착수 순서였을 뿐이고, 실제
제품은 그 위에 얹혔다 — 표를 CP만으로 읽으면 지금 서비스를 알 수 없다.

**퀴즈만 남았다.** `POST /lessons/{id}/quizzes/answers`가 FE 어댑터에 501로 박혀 있고 서버에는
도메인이 없다(의도된 미구현 — 없는 경로를 호출해 404를 받으면 화면이 서버 장애와 구별하지 못한다).

---

## 10-1. 알림 센터

사건에서 알림까지의 경로, 명단을 앱에 올리지 않는 팬아웃, 실시간 두 층(STOMP·Web Push)은
분량이 커서 별도 문서로 뺐다 — **[NOTIFICATION-CENTER.md](NOTIFICATION-CENTER.md)**.
설계 결정은 [ADR-0073](decisions/songjeongki/0073-notification-fanout-architecture.md),
API 규격은 [CONTRACT §2-4](CONTRACT.md)가 정본이다.

## 11. 신뢰성 · 관측성

- **추적**: Micrometer Tracing(Brave)이 요청마다 traceId/spanId를 MDC에 넣어 로그와 에러 응답을 한 요청으로 묶는다 ✅. 익스포터(Zipkin/OTel) 연결은 후속 ⬜.
- **메트릭**: Prometheus 레지스트리로 `/actuator/prometheus` 노출 ✅. 스크레이프·대시보드는 후속 ⬜.
- **동시성**: 낙관적 락(`@Version`) 충돌은 전역 핸들러가 409로 변환한다. 커리큘럼 구조 변경은 `structure_version` CAS로 잃어버린 갱신을 막는다([ADR-0025](decisions/songjeongki/0025-structure-reorder-and-version-cas.md)).
- **degraded**: LLM/STT/임베딩 장애 시 자막·보강만 멈추고 코어(라이브 영상·채팅·다시보기)는 유지한다. AI 전면 장애 시 Spring이 서킷을 연다. **미디어 경로는 AI와 무관하게 생존한다.**
- **잡 신뢰성**(CP3): outbox + idempotency key + DLQ + correlation_id로 React→Spring→AI→Worker를 한 줄로 추적한다.

---

## 12. 열린 항목

- 잡 envelope·결과 메시지·Redis Streams caption 스키마 → [CONTRACT.md](CONTRACT.md)
- 세션 시계 변환 기준(LiveKit 트랙 타임스탬프 → 세션 상대 ms)
- 한국어 STT 공급자 bake-off, 임베딩 모델 선정, RAG 평가 게이트
- 운영 하드닝: 쿠키 `secure` 강제, WS origin 화이트리스트 축소, actuator 노출 범위 제한
