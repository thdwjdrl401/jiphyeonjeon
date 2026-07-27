# STT engines

## 역할

실시간 오디오 입력과 transcript 이벤트 출력의 provider-neutral 계약을 정의하고 설정에 맞는 구현을 선택한다.

## 구조와 흐름

room job은 공통 engine 인터페이스만 사용한다. registry가 `stub`, `openai-realtime`, `nemotron` 중 하나를 만들고,
필요하면 audio segmentation을 provider adapter 앞에 조립한다.

## 파일 구성

- `engine.py`: audio write·event iteration·finish·close 계약
- `registry.py`: 설정 기반 provider 생성
- `nemotron_asr.py`: 로컬 Nemotron ASR 실행 경계
- `providers/`: provider별 adapter

## 경계와 불변식

audio producer와 event consumer는 각각 하나이며 engine event iterator를 여러 곳에서 소비하지 않는다.
finish와 close는 제한된 시간 안에 끝나야 하며 provider 오류를 정상 completion으로 바꾸지 않는다.

## 검증

`tests/test_stt_registry.py`, `tests/test_*provider*.py`, `tests/test_nemotron_asr.py`로 공통 계약과 구현을 검증한다.
