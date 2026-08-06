# Caption pipeline

## 역할

STT 엔진 이벤트를 순서가 있는 실시간 자막 이벤트로 바꾸고 publisher에 전달한다.

## 구조와 흐름

pipeline은 첫 audio frame에서 started를 먼저 publish하고, 단일 `engine.events()` consumer로 delta와
segment.final을 순서대로 처리한다. CaptionTextNormalizer가 provider 출력의 dash·웃음 표시 노이즈를
정규화한 뒤 Redis publisher에 await한다. final은 `segmentIndex`와 `lastSequence`로 delta를 확정하며
정상 room 삭제 후에만 completed를 만든다.

## 파일 구성

- `models.py`: started·delta·segment.final·completed 내부 모델
- `text_normalizer.py`: append-only delta 경계를 보존하는 표시 텍스트 정규화
- `pipeline.py`: STT 이벤트 매핑, delta/segment 순번, 시간 앵커와 완료 처리

## 경계와 불변식

`sequence`는 attempt에서 1부터, `segmentIndex`는 0부터 증가한다. 정규화 결과가 빈 delta나
segment면 해당 순번을 소비하지 않는다. `audioStartedAt`은 `streamElapsedMs=0`인 첫 frame 시작 UTC다.
segment.final 본문은 해당 `lastSequence`까지의 delta보다 권위 있다. 한 segment가 문장별 final 여러 개로
나뉘어 오면(ADR-0086) 이미 delta로 나간 text는 `text_already_delivered`로 표시돼 다시 delta가 되지
않는다 — 다만 살아남은 delta가 하나도 없으면 `lastSequence`가 0이 될 수 없으므로 그때는 delta를 만든다. `ROOM_DELETED`가 아닌 실패에서는
거짓 completed를 발행하지 않는다.

## 검증

`tests/test_caption_contract.py`, `tests/test_caption_pipeline.py`에서 필드 형식, 순서, 완료 조건을 검증한다.
