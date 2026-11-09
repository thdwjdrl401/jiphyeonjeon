# realtime-agent tests

## 역할

실시간 파이프라인의 단위 계약, 외부 wire format, 비동기 race와 종료 정리를 검증한다.

## 구조와 흐름

실제 LiveKit·Redis·HTTP·STT provider 대신 fake를 사용해 입력과 실패 시점을 통제한다. JSON Schema와 fixture로
후보 통신 계약을 별도로 검증한다.

## 파일 구성

- `test_candidate_contract_schemas.py`: started/delta/segment.final/completed 후보 schema와 UTF-8 fixture
- `test_caption_pipeline.py`: started 선행, delta/segment 순번, provider final 권위와 completion
- `test_audio_segmentation.py`, `test_livekit_audio_source.py`: VAD speech 경계와 첫 frame UTC 앵커
- `test_*provider*.py`: provider delta/final 정규화와 lifecycle
- `test_redis_*.py`, `test_spring_status_callback.py`: 외부 adapter wire shape와 실패 처리
- `test_room_job*.py`, `test_lifecycle.py`, `test_shutdown_deadline.py`: started-before-audio와 job 종료 race
- `test_job_metadata.py`: dispatch schema 계약
- `test_stt_catalog.py`, `test_stt_registry.py`: provider profile, active/idle 상한과 prewarm resource 소유권
- `test_main.py`, `test_config.py`: AgentServer load 계산과 환경 변수 조립

## 경계와 불변식

단위 테스트 통과는 실제 LiveKit·Redis·Spring·provider 연동 증거를 대신하지 않는다. 외부 자격 증명이 필요한
smoke/E2E 검증은 별도 opt-in으로 수행해야 한다.

통신 테스트도 기본 suite에서는 network를 열지 않는다. LiveKit Worker/Room, Redis, Spring HTTP,
OpenAI WebSocket은 fake boundary로 대체해 payload, timeout, cancellation과 멱등성 전제만 검증한다.
실제 Room→provider→Redis 결과와 GPU 동시성 증거는
[`docs/ai/GPU-REALTIME-AGENT-RUNBOOK.md`](../../../docs/ai/GPU-REALTIME-AGENT-RUNBOOK.md)에 별도로 남긴다.

## 검증

서비스 루트에서 `uv run --frozen pytest -q -p no:cacheprovider`로 전체 테스트를 실행한다.
