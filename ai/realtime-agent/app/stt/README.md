# STT engines

## 역할

실시간 오디오 입력과 transcript 이벤트 출력의 provider-neutral 계약을 정의하고 설정에 맞는 구현을 선택한다.

## 구조와 흐름

room job은 공통 engine 인터페이스만 사용한다. catalog가 `stub`, `openai-realtime`, `nemotron`의 engine
factory와 실행 profile을 등록하고, registry가 선택한 구현과 선택적인 prewarmed process resource를
조립한다. 필요하면 audio segmentation을 provider adapter 앞에 둔다.

## 파일 구성

- `engine.py`: audio write·event iteration·finish·close 계약
- `catalog.py`: provider별 설정 검증, factory와 worker 실행 profile 등록
- `registry.py`: provider 선택, worker pool 해석과 process resource 소유권 이전
- `nemotron_asr.py`: 로컬 Nemotron ASR 실행 경계
- `providers/`: provider별 adapter

## 경계와 불변식

audio producer와 event consumer는 각각 하나이며 engine event iterator를 여러 곳에서 소비하지 않는다.
finish와 close는 제한된 시간 안에 끝나야 하며 provider 오류를 정상 completion으로 바꾸지 않는다.
CUDA model은 parent에서 만들거나 fork하지 않고 job child setup에서 load한다. process resource가 필요한
provider의 실제 job은 prewarm resource 누락 시 cold-load로 우회하지 않는다.

## 검증

`tests/test_stt_registry.py`, `tests/test_*provider*.py`, `tests/test_nemotron_asr.py`로 공통 계약과 구현을 검증한다.
