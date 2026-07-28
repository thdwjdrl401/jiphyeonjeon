# STT providers

## 역할

외부 또는 로컬 STT 구현을 공통 engine 계약에 맞추는 adapter 모음이다.

## 구조와 흐름

registry가 provider를 선택한다. streaming provider는 PCM을 지속 전송하고, segmented provider는 발화 단위로
나눈 뒤 backend를 호출한다. `stub`은 로컬 wiring과 테스트 전용이다.

## 파일 구성

- `openai_realtime.py`: `intent=transcription` session을 사용하는 OpenAI Realtime STT 연결
- `nemotron.py`: 로컬 Nemotron backend adapter
- `segmented.py`: segment 기반 provider 생명주기
- `stub.py`: 외부 의존성 없는 개발·테스트 구현

## 경계와 불변식

provider 자격 증명과 선택은 환경 변수로 주입한다. `stub` 결과를 실제 STT 품질 검증으로 간주하지 않으며,
Nemotron은 process-wide model을 공유하지 않고 job child마다 독립 model을 소유한다. provider profile은
H200 한 장에서 worker당 active job 상한 12, 기본 warm idle process 12를 사용한다. LiveKit Agents
1.6.6의 초기 burst reservation도 idle 수를 사용하므로 12-request burst에는 두 값을 같게 둔다.

## 검증

`tests/test_openai_realtime_provider.py`, `tests/test_nemotron_provider.py`,
`tests/test_segmented_provider_lifecycle.py`, `tests/test_stub_engine.py`에서 provider별 계약을 검증한다.
