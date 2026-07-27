# Caption pipeline

## 역할

STT 엔진 이벤트를 순서가 있는 실시간 자막 이벤트로 바꾸고 publisher에 전달한다.

## 구조와 흐름

pipeline은 단일 `engine.events()` consumer로 delta를 읽고 `sequence`와 첫 audio frame 기준
`streamElapsedMs`를 계산해 Redis publisher를 await한다. 정상 room 삭제 후에만 completed 이벤트를 만든다.

## 파일 구성

- `models.py`: 자막 delta·completed 내부 모델
- `pipeline.py`: STT 이벤트 매핑, 순번·경과 시간, 완료 처리

## 경계와 불변식

`sequence`는 `(sessionId, sttSessionId)` 범위에서 1부터 증가한다. `streamElapsedMs`는 세션 생성 시간이 아니라
realtime-agent가 첫 audio frame을 받은 때가 0이다. `ROOM_DELETED`가 아닌 실패에서는 거짓 completed 이벤트를
발행하지 않는다.

## 검증

`tests/test_caption_contract.py`, `tests/test_caption_pipeline.py`에서 필드 형식, 순서, 완료 조건을 검증한다.
