# Runtime contracts

## 역할

Spring 상태 callback의 내부 모델과 결정적 JSON 직렬화를 제공한다.

## 구조와 흐름

job 생명주기가 상태 모델을 만들면 adapter가 compact JSON bytes로 직렬화하고, 그 동일한 bytes를 HTTP body와
HMAC 서명 입력으로 사용한다.

## 파일 구성

- `live_status.py`: 상태 enum, 오류, 상태 이벤트 모델과 terminal 상태 정의
- `serialization.py`: UTC RFC 3339와 compact JSON bytes 직렬화

## 경계와 불변식

상태는 `ROOM_CONNECTED`, `STT_STARTED`, `AUDIO_STARTED`, `STOPPING`, `SUCCEEDED`, `FAILED` 중 하나다.
`FAILED`에만 `error={code,message,retryable}`가 필수이며 다른 상태에는 없어야 한다.

## 검증

`tests/test_spring_status_callback.py`와 [`../../contracts/`](../../contracts/README.md)의 schema fixture 검증이
모델과 wire payload의 일치를 확인한다.
