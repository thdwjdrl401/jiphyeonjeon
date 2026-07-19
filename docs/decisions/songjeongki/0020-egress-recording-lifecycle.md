# ADR-0020: 라이브 녹화 생명주기 = 세션 이벤트 기반 best-effort Egress 제어

> 📍 하네스 개요: [../../harness/README.md](../../harness/README.md) · 아키텍처: [../../ARCHITECTURE.md](../../ARCHITECTURE.md) · 계약: [../../CONTRACT.md](../../CONTRACT.md)

- **상태**: 채택
- **일자**: 2026-07-19
- **관련**: [0010](0010-self-host-vod.md), [0007](0007-domain-live-session.md), [0019](0019-ws-realtime-chat-stomp.md)

## 맥락
- [ADR-0010](0010-self-host-vod.md)이 VOD/다시보기를 **LiveKit Egress → HLS → MinIO + `core.video_asset`**로 결정. 이제 그 **녹화 시작·중지를 라이브 세션 생명주기에 어떻게 잇는지**가 남았다.
- `video_asset`엔 기술 상태기계(REQUESTED→STARTING→RECORDING→FINALIZING→VERIFYING→READY/FAILED)와 공개 상태(replay_status)가 이미 있고, `live_session.recording_enabled` 플래그도 있다.
- 원칙 #6([ARCHITECTURE](../../ARCHITECTURE.md)): **미디어/AI 장애가 코어(라이브)를 막지 않는다(degraded).** 녹화가 안 켜져도 강의는 진행돼야 한다.

## 결정
1. **세션 이벤트 기반, best-effort.** `LiveSessionService`가 LIVE/ENDED 전이 커밋 후 `LiveSessionStartedEvent`·`LiveSessionEndedEvent`(live.api, 노출)를 발행한다. `video` 모듈의 리스너가 `@TransactionalEventListener(AFTER_COMMIT)`로 받아 Egress를 켜고 끈다.
   - **왜 커밋 후 이벤트인가**: (a) Egress 네트워크 호출이 세션 트랜잭션을 물지 않게, (b) 녹화 실패가 세션 시작/종료를 롤백하지 않게, (c) 롤백된 세션은 녹화하지 않게. ([0019](0019-ws-realtime-chat-stomp.md)의 채팅 브로드캐스트와 같은 패턴.)
2. **EgressControl 포트** — `RoomServiceClient` 래핑([0019] 이전의 `LiveRoomControl`)과 같은 모양. HLS 세그먼트 출력 + S3/MinIO 업로드는 `EgressServiceClient.startRoomCompositeEgress(SegmentedFileOutput)`. 중지는 `stopEgress`(대상 없으면 멱등 성공).
3. **상태 전이**: 시작 시 `video_asset` REQUESTED 생성 → Egress 성공 시 RECORDING(+egress_id), 실패 시 FAILED. 세션 종료 시 RECORDING만 FINALIZING으로. **FINALIZING→VERIFYING→READY는 Egress 완료 webhook으로 전이(후속)**.
4. **LiveKit 접속 설정을 `common`으로.** `LiveKitProperties`(url·apiKey·apiSecret)는 live(방·토큰)와 video(egress) 공용 인프라라 `common.config`로 옮겨 단일 출처로 둔다. Egress 출력(S3/MinIO)은 `livekit.egress.*`(video).
5. **모듈 경계**: video → live.api(이벤트) + common. 트랜잭션 로직은 `RecordingService`(별도 빈), 이벤트 글루는 `RecordingEventListener` — 프록시 자기호출을 피하려 분리.

## 근거
- 이벤트+AFTER_COMMIT이 "저장된 것만, 코어를 막지 않고" 처리한다는 불변식을 구조적으로 보장한다.
- 포트로 감싸 Egress 없이도 상태기계·배선을 목으로 검증 가능(테스트 6개).
- `recording_enabled=false`면 자산조차 만들지 않아 낭비가 없다.

## 대안
| 대안 | 장점 | 단점 |
|---|---|---|
| **세션 이벤트 best-effort (선택)** | 코어 비차단·경로 디커플·롤백 안전 | webhook 완료 처리 별도 필요 |
| 세션 트랜잭션 내 동기 호출 | 코드 짧음 | 네트워크가 tx를 물고, 실패가 세션을 롤백 |
| 별도 스케줄러 폴링 | 세션과 완전 분리 | 지연·복잡·상태 동기화 어려움 |

## 영향·후속
- **미검증(중요)**: `LiveKitEgressControl`의 실제 Egress 호출은 **아직 실환경 e2e로 검증 안 됨**(egress 컨테이너·MinIO·발행 참가자 필요). 토큰/강퇴처럼 실인프라 확인은 후속. 현재는 상태기계·이벤트 배선만 목으로 검증됨.
- **완료 webhook 후속**: LiveKit egress 상태 webhook을 받는 엔드포인트 → FINALIZING→VERIFYING→READY 전이 + `hls_manifest_key`·`duration_ms`·`segment_count`·`session_offset_ms` 채우기.
- **재생(LIVE-PLAYBACK-01)·처리 조회(LIVE-SESSION-09)**: FE 계약 확정 시 `GET /lessons/{id}/playback` + `PlaybackTokenService` no-op seam([0010]).
- **저장소**: MinIO로 시작, 운영 S3 배정 시 `livekit.egress.*` 교체(코드 불변).
