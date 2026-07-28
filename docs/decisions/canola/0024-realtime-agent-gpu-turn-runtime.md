# ADR-0024: GPU realtime-agent는 명시적 env 주입과 별도 TURN secret을 사용

- **상태**: 채택
- **일자**: 2026-07-28
- **관련**: [ADR-0010](0010-realtime-agent-room-job-boundary.md),
  [ADR-0012](0012-realtime-stt-provider-and-overload-boundary.md),
  [ADR-0014](0014-realtime-agent-lifecycle-candidate-contract.md)

## 맥락

GPU 실험 환경에서는 CUDA 12.8 PyTorch, 외부 LiveKit·Redis의 SSH TCP tunnel, EC2 loopback coturn을
조합해 실제 microphone과 한글 caption 발행을 확인했다. 실험판은 host·PEM 기본값, 자동 `.env` 탐색,
LiveKit API secret을 coturn REST auth에도 재사용하고 프로세스 외부의 임시 DNS shim에 의존했다.
이를 정식 clone에 그대로 복사하면 credential 경계와 재현성이 약해지고, 정식판의 bounded audio 및
shutdown 구현도 덮일 수 있다.

## 결정

1. 현재 GPU driver에서 검증한 `torch==2.11.0+cu128`과 PyTorch cu128 index를 Nemotron extra에 고정한다.
   CPU 기본 환경과 CUDA extra 분리는 유지한다.
2. production entrypoint는 `.env`를 자동 탐색하지 않는다. 개발자는 `uv run --env-file <path>`처럼
   선택한 파일을 명시하고 배포는 process environment/secret manager를 사용한다.
3. SSH tunnel 도구는 key, target과 변경 포트를 인자로 받고 저장소에 host/IP/PEM 기본값을 두지 않는다.
4. `LIVEKIT_URL`은 TLS 인증서 hostname을 유지한다. SSH `-L`이 UDP를 전달하지 않으므로 제한된 환경은
   `turn:127.0.0.1:3478?transport=tcp`와 relay-only RTC configuration을 사용한다.
5. coturn REST credential은 `LIVEKIT_TURN_SECRET`으로 생성한다. `LIVEKIT_API_SECRET`으로 암묵 fallback하지
   않아 signaling API credential과 TURN credential의 rotation·노출 범위를 분리한다.
6. custom RTC 설정은 기존 audio source에 선택적으로 주입한다. 설정이 없으면 SDK 기본 ICE를 유지하고,
   bounded queue, `ROOM_DELETED`, absolute shutdown deadline 구현은 변경하지 않는다.
7. 모델은 Git 밖에 두고 `ASR_MODEL_ID`로 경로를 주입한다. 임시 DNS shim은 영구 의존으로 채택하지 않는다.

## 영향

- 기존 coturn이 LiveKit API secret만 공유한다면 배포 secret에 같은 값을 명시적으로 복제하거나 별도
  TURN secret으로 rotation해야 한다. 코드가 두 credential의 동일성을 가정하지 않는다.
- TCP-only 네트워크에서도 LiveKit SDK 1.6.6의 정식 `rtc_config` API로 relay를 강제할 수 있다.
- host별 DNS routing과 장시간 tunnel 운영은 인프라 후속 과제다. 30분 media 안정성 및 Spring 전체
  왕복 검증 전에는 migration 전체를 완료로 선언하지 않는다.
- 변경은 AI runtime 설정이며 Java 공유 payload를 바꾸지 않아 `docs/CONTRACT.md` 수정은 필요하지 않다.
