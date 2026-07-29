# ADR-0032: realtime-agent는 model warm pool과 LiveKit 연결을 분리한 service health를 제공

- **상태**: 채택
- **일자**: 2026-07-29
- **관련**: [ADR-0028](0028-stt-provider-execution-profile-and-warm-pool.md),
  [ADR-0030](0030-cross-host-realtime-agent-deployment.md),
  [공유 계약 §3-3·§3-8](../../CONTRACT.md#3-내부-계약-확정-인터페이스)

## 맥락

배포 pipeline과 향후 consumer는 GPU realtime-agent process가 살아 있는지, 그리고 실제 요청을 받기 전에
Nemotron warm pool이 전부 올라오고 LiveKit worker가 연결됐는지를 구분해 확인해야 한다. 기존
LiveKit Agents 1.6.6의 `/` health는 HTTP server와 terminal connection failure만 확인한다. child model
초기화가 timeout으로 덜 끝난 상태나 최초 LiveKit 등록 전에도 200을 줄 수 있어 배포 완료 또는 consumer
사전 진단의 근거로 부족하다.

반대로 service health를 특정 dispatch job의 readiness로 사용하면 안 된다. service가 준비됐어도 아직
job 용량을 예약하지 않았고 session lease, application Redis, room microphone, engine queue는 job 안에서만
검사할 수 있다.

## 결정

1. realtime-agent가 `127.0.0.1:8081`에 자체 HTTP server를 열고 `GET /health/live`와
   `GET /health/ready`를 제공한다. 기존 SDK HTTP server는 같은 process의 loopback ephemeral port로
   이동한다. `/` plain `OK`는 기존 수동 smoke 호환으로만 남긴다.
2. liveness는 health server가 응답 가능한 동안 200이다. readiness는 AgentServer가 시작됐고 현재
   LiveKit worker WebSocket이 연결됐으며 설정된 모든 child process가 provider `prewarm()`을 성공했을
   때만 200이다. 그 전에는 동일 진단 body와 503을 반환한다.
3. child setup은 prewarm 성공 뒤 process별 marker를 원자적으로 쓴다. parent는 고유 임시 디렉터리와
   Linux `/proc/{pid}/stat` starttime을 함께 확인해 종료된 process와 PID reuse marker를 제외한다.
   Nemotron에서는 marker가 model `load()` 완료를 뜻한다. remote provider는 startup prewarm만 뜻하며
   특정 job의 원격 STT session 연결은 job-level readiness에서 별도로 확인해야 한다.
4. LiveKit Agents 1.6.6은 disconnect event를 공개하지 않는다. 최초 `worker_registered` event와 고정된
   1.6.6의 reconnect flags(`_connecting`, `_connection_failed`)를 함께 읽어 재연결 중 readiness를
   fail-closed한다. SDK 버전 변경 시 이 pin을 테스트와 함께 재검토한다.
5. JSON v1 schema와 fixture를 Python producer test로 검증한다. Java/Spring consumer 구현과 네트워크
   경로는 별도 backend 변경으로 다룬다. 이 endpoint는 진단/배포 전 확인용이며 `live.stt.assume-ready`
   또는 §3-3의 job-level `STT_READY`를 자동으로 바꾸지 않는다.
6. GPU→EC2 reverse tunnel은 계속 loopback에만 bind하고 host smoke는 18081을 직접 호출한다. health
   port를 public ingress로 열지 않는다.
7. GPU 배포 helper는 liveness가 아니라 `/health/ready` 200을 새 release 성공 조건으로 삼는다. timeout이면
   기존 release로 rollback한다.

## 영향

- 배포 도구와 향후 consumer는 `status`, provider, model process 수, AgentServer/LiveKit 조건을 한
  응답에서 구분할 수 있다.
- model load timeout이나 일부 child crash는 배포 성공으로 오인되지 않는다.
- endpoint는 dispatch capacity를 예약하지 않으며 실제 강의 시작 안전성은 기존 job gate 책임으로 남는다.
- SDK private reconnect flag 사용은 의도적인 version pin이다. `livekit-agents`를 올릴 때 targeted test와
  실제 disconnect/reconnect smoke가 필요하다.

## 검증

- Python은 liveness 200, readiness 503→200, stale PID marker 제외, process marker pickle, LiveKit
  reconnect fail-closed와 runtime serializer↔fixture 일치를 검증한다.
- operational test는 배포 helper가 `/health/ready`를 기다리는지와 reverse tunnel이 loopback인지
  고정한다.
