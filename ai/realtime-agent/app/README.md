# realtime-agent application

## 역할

LiveKit job을 받아 실시간 오디오를 STT로 변환하고 자막과 상태를 외부로 전달하는 프로세스의 조립 지점이다.

## 구조와 흐름

`main.py`가 설정을 읽어 `AgentServer`와 job handler를 등록한다. handler는 `jobs/`의 생명주기를 중심으로
`livekit/` 오디오 입력, `stt/` 엔진, `captions/` 파이프라인, `adapters/` 외부 통신을 연결한다.

## 파일 구성

- `main.py`: `dev`·`start` 실행 진입점과 LiveKit worker 등록
- `config.py`: 환경 변수 검증과 실행 설정
- `jobs/`: dispatch metadata 검증과 room job 생명주기
- `livekit/`, `audio/`, `stt/`, `captions/`: 오디오에서 자막까지의 처리 단계
- `adapters/`, `contracts/`: Redis·HTTP 통신과 payload 모델

## 경계와 불변식

이 디렉터리는 실행을 조립하되 전송 형식을 임의로 만들지 않는다. AI-side 후보 통신 규격은
[`../CONTRACT.md`](../CONTRACT.md)와 [`../contracts/`](../contracts/README.md)를 따른다.

## 검증

`tests/test_main.py`, `tests/test_config.py`, 각 하위 모듈 테스트로 조립과 설정 경계를 검증한다.
