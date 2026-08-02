# ADR-0034: Egress 완료 webhook — 녹화 자산 확정(READY/FAILED)과 서명 검증

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-26
- **관련**: [0020](0020-egress-recording-lifecycle.md)(녹화 생명주기), [0010](0010-self-host-vod.md)(Egress VOD), [0032](0032-media-playback-hls-only.md)(HLS 단일 재생), [0004](0004-media-livekit-selfhost.md)(LiveKit self-host), [ADR-0005](../choinhoo/0005-ended-hls-caption-drain.md)(학생 HLS drain), [ADR-0007](../choinhoo/0007-recording-ready-auto-publish-and-processing-polling.md)(READY 자동 게시·처리 폴링) · Jira liveclass-103, 관련 liveclass-100(재생 API)

> **2026-08-02 부분 대체**: 이 ADR의 webhook 인증·manifest 검증·terminal first-wins는 유지한다.
> 새 정상 녹화의 성공 확정은 ADR-0007이 `VideoAssetStatus.READY`만 저장하던 흐름을
> `VideoAssetStatus.READY + ReplayStatus.PUBLISHED` 원자적 커밋으로 확장하며 코드에도 반영됐다.

## 맥락

당시 녹화 생명주기([0020])는 `REQUESTED → RECORDING → FINALIZING`까지만 구현돼 있었다.
`FINALIZING → VERIFYING → READY` 전이와 `durationMs`·`sizeBytes`·`segmentCount`·`readyAt`
채우기는 "Egress 완료 webhook으로(후속)" 주석에만 있고 **수신기가 없었다**. 그래서 자산은
`FINALIZING`에 멈추고 메타데이터가 영원히 null이었다. 여기의 `REQUESTED`는 역사적 상태이며,
현재 상태 집합에서는 [ADR-0006](../choinhoo/0006-remove-video-asset-requested-status.md)으로 제거됐다.

**이 작업은 이미 재생 중인 HLS의 선행이 아니다.** [0032]가 확정한 HLS 단일 재생 +
[liveclass-100]의 재생 API는 **녹화 시작 시 결정되는 매니페스트 키**
(`sessions/{sessionId}/index.m3u8`·`live.m3u8`)로 동작한다. 기존 classroom은 webhook 전
`FINALIZING/VERIFYING` 동안에도 같은 HLS를 계속 소비한다(ADR-0005). webhook은 최종 HLS와 실패를
확정하는 후속 신호다: 목록·썸네일의 재생 길이/용량 표시, ENDLIST 확정, 녹화 실패 감지.

## 결정

### 1. LiveKit egress webhook을 수신해 자산을 확정한다

`POST /api/webhooks/livekit` — LiveKit이 egress 종료 시 보내는 `egress_ended` 이벤트를 받는다.

- **완료**(`EGRESS_COMPLETE`) + manifest 검증 성공 → 새 정상 녹화는 같은 DB 트랜잭션에서 자산
  `READY` + replay `PUBLISHED` + `durationMs`·`sizeBytes`·`segmentCount`·`readyAt`·`publishedAt`
- **실패/중단**(`EGRESS_FAILED` 등) → 자산 `FAILED` + `failureCode`
- **멱등**: 이미 `READY`/`FAILED`면 무시. 기존 `READY + DRAFT`와 `WITHDRAWN`을 중복 webhook으로
  게시하지 않는다. **모르는 `egressId`도 조용히 무시**한다 — 우리 자산이 아닌데 실패로 표시하지 않기 위해.
- `duration`은 proto-JSON에서 **나노초**로 오므로 ms로 환산한다.

### 2. 서명 검증이 실질 인증 — 경로는 permitAll이되 JWT로 막는다

LiveKit은 로그인 세션이 없다. 대신 `Authorization` 헤더에 **JWT**를 실어 보내는데, apiSecret으로 HS256 서명되고 payload의 `sha256` 클레임이 **본문의 SHA-256(base64)**이다. 서명과 본문 해시를 **둘 다** 확인해야 위조·변조를 막는다.

- `SecurityConfig`에서 `/api/webhooks/livekit`을 **permitAll** + **CSRF 면제**(외부 호출이라 토큰이 없다). 인증은 `LiveKitWebhookVerifier`가 한다.
- 본문은 **원시 바이트(`byte[]`)**로 받는다 — 프레임워크가 JSON으로 역/재직렬화하면 해시가 어긋난다. 검증 통과 후에만 파싱한다.
- 검증 실패는 video 소유 예외(`WebhookVerificationException`) → **401**. 공용 `@ExceptionHandler(Exception.class)`가 먼저 잡아 500으로 바꾸지 않도록, video web 한정 핸들러를 우선순위 높여 둔다.

## 근거

- **webhook > 폴링.** LiveKit이 완료 시점에 정확히 알려주고 duration/size까지 실어 준다. 폴링은 스토리지를 주기적으로 뒤져야 하고 시점이 부정확하다.
- **모르는 egressId 무시**가 핵심 안전장치다 — webhook은 permitAll이라(서명은 맞아도) 다른 프로젝트/재사용 키의 egress가 들어올 수 있는데, 우리 자산이 아니면 아무것도 하지 않는다.
- **재생과 분리.** 이 작업이 늦어지거나 실패해도 재생은 매니페스트 키로 이미 동작한다([0032]·100). 그래서 Jira에서 "선택"으로 재정의됐고, 여기서도 견고성 보강으로 다룬다.

## 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| **webhook 수신 (선택)** | 완료 시점·메타를 정확히, 실패 감지 | 인프라에 webhook URL·서명 키 설정 필요 |
| 스토리지 폴링 | LiveKit 설정 불필요 | 시점 부정확, 스토리지 부하, duration을 매니페스트 파싱으로 유도 |
| 아무것도 안 함(현행) | — | 자산이 FINALIZING에 멈춤, duration/size null, 실패 감지 불가 |

## 영향·후속

- **검증**: `LiveKitWebhookContractTest` 10건 — 완료→(VERIFYING)→READY+메타, 매니페스트 부재→FAILED, 확인 불가→fail-open READY, 실패→FAILED, 서명 위조·누락·본문 변조→401, 멱등, 모르는 egress·비종료 이벤트 무시. `ModularityTests` 통과(video→live.api 방향 유지). 전체 스위트 통과.
- **인프라 설정 (완료)**: `infra/livekit/livekit.yaml`에 `webhook: { api_key: <API_KEY>, urls: [https://jiphyeonjeon.thdwjdrl.com/api/webhooks/livekit] }`를 추가했다. `api_key`는 `keys`의 key와 같아야 하고(그 secret으로 JWT 서명), Spring이 같은 secret으로 검증한다. url은 app nginx가 `/api`를 backend로 프록시하는 경로다. secret은 템플릿대로 서버에서 채운다(커밋 금지). **배포 후 실동작 검증**: 라이브 종료 → egress 완료 → 자산 READY + duration 확인.
- **매니페스트 키(`hlsManifestKey`)**: 100(재생 API, 조인후) 담당이다 — 녹화 시작 시 세팅. 이 webhook은 그 값을 건드리지 않고 상태·메타만 확정한다. 두 작업의 경계.
- **VERIFYING 구현 (2026-07-26)**: 완료 신호를 곧바로 믿지 않고 `FINALIZING → VERIFYING → READY/FAILED`로 간다. VOD 매니페스트(`sessions/{sessionId}/index.m3u8`)를 스토리지에서 HEAD로 재확인해 "COMPLETE인데 파일이 없는" 케이스를 잡는다. **부재 확정(404) → FAILED(`MANIFEST_MISSING`)**, **존재 → READY**, **확인 불가(네트워크·설정 예외) → READY(fail-open)** — 검증기 자체가 새로운 실패원인이 되지 않도록 webhook의 COMPLETE를 신뢰한다. HEAD는 video 모듈 자체 `RecordingStorage`/`S3RecordingStorage`(egress 버킷·`livekit.egress.*` 자격)로 친다 — asset 모듈 `S3Client` 빈과 충돌하지 않게 빈이 아닌 필드로 클라이언트를 생성(lazy). 매니페스트 키 규약은 `RecordingService`가 녹화 시작 prefix(`sessions/{id}`)와 공유해 드리프트를 막는다.
- **자동 게시 확장(ADR-0007, 구현됨)**: 위 성공 확정 트랜잭션에 `replay_status=PUBLISHED`,
  `published_at=now`, `published_by=null`을 포함한다. 실패·manifest 부재는 `DRAFT`를 유지한다.
