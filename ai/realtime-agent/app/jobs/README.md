# Room jobs

## 역할

LiveKit dispatch metadata를 검증하고 한 room job의 시작부터 종료·정리까지를 관리한다.

## 구조와 흐름

metadata를 strict parsing한 뒤 assigned room이 정확히 `session-{sessionId}`인지 확인한다. Redis lease를 획득하고
room 연결, audio 구독, STT·caption task를 시작한다. `ROOM_DELETED`를 정상 종료 신호로 삼아 deadline 안에서
drain, completion, callback, lease 해제를 수행한다.

## 파일 구성

- `metadata.py`: dispatch JSON 크기·중복 키·필드·UUID 검증
- `dispatched_room_job.py`: LiveKit job context와 application job 연결
- `room_job.py`: audio/STT/caption 실행과 종료 orchestration
- `lifecycle.py`: 상태 전이와 callback
- `shutdown_deadline.py`: 종료 작업이 공유하는 절대 deadline

## 경계와 불변식

dispatch metadata는 최대 4096 bytes이며 정확히 다음 모양이어야 한다.

```json
{
  "contractVersion": "1",
  "sessionId": "00000000-0000-0000-0000-000000000000",
  "lessonId": "00000000-0000-0000-0000-000000000000",
  "correlationId": "safe-id"
}
```

UUID는 소문자 canonical 형식이고 추가·중복 필드는 거부한다. room 이름 불일치, lease 상실, 비정상 disconnect는
fail-closed 처리하며 `SUCCEEDED`나 caption completion으로 바꾸지 않는다.

## 검증

`tests/test_job_metadata.py`, `tests/test_dispatched_room_job.py`, `tests/test_room_job*.py`,
`tests/test_shutdown_deadline.py`에서 파싱·race·cleanup·terminal 상태를 검증한다.
