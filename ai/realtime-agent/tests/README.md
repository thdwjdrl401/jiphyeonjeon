# realtime-agent tests

## 역할

실시간 파이프라인의 단위 계약, 외부 wire format, 비동기 race와 종료 정리를 검증한다.

## 구조와 흐름

실제 LiveKit·Redis·HTTP·STT provider 대신 fake를 사용해 입력과 실패 시점을 통제한다. JSON Schema와 fixture로
후보 통신 계약을 별도로 검증한다.

## 파일 구성

- `test_candidate_contract_schemas.py`, `test_job_metadata.py`: dispatch·schema 계약
- `test_redis_*.py`, `test_spring_status_callback.py`: 외부 adapter wire shape와 실패 처리
- `test_room_job*.py`, `test_lifecycle.py`, `test_shutdown_deadline.py`: job 생명주기와 race
- `test_audio_*.py`, `test_*provider*.py`: 오디오와 STT provider 계약

## 경계와 불변식

단위 테스트 통과는 실제 LiveKit·Redis·Spring·provider 연동 증거를 대신하지 않는다. 외부 자격 증명이 필요한
smoke/E2E 검증은 별도 opt-in으로 수행해야 한다.

## 검증

서비스 루트에서 `uv run --frozen pytest -q -p no:cacheprovider`로 전체 테스트를 실행한다.
