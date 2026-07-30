# `ai-api/app/lecture_notes`

[ADR-0034](../../../../docs/decisions/canola/0034-near-realtime-accumulative-lecture-notes.md)의
축적형 강의 노트 MVP 코어다.

현재 단계는 `CaptionDelta|CaptionCompleted`를 모델 입력용 `LectureNoteWindow`로 접고, 구조화 모델
결과를 topic 정본과 제한된 Markdown으로 반영한다. application service는 세션별 호출을 직렬화하고
대기 window를 한 batch로 합친 뒤 snapshot port로 내보낸다. Redis snapshot·결과 Stream adapter는
구현했고 별도 GMS 구조화 JSON model도 제공한다. input consumer와 application lifecycle에는 아직
연결하지 않았다.

## 현재 보장

- leading space를 포함한 delta text를 순서대로 보존한다.
- `eventId`와 attempt-local `sequence` 중복을 제거한다.
- sequence gap은 metric에 기록하고 이후 delta 처리는 계속한다.
- 15/25/40초와 80/400자, 강한 문장 종결을 조합해 window를 자른다.
- attempt 전환과 stream completion에서는 짧은 남은 text도 flush한다.
- 다음 window에는 직전 window의 마지막 두 문장만 이전 문맥으로 전달한다.
- `CONTINUE|START_NEW` 결과를 topic 정본에 반영하고 완전히 같은 key point만 제거한다.
- Markdown 구조는 애플리케이션이 만들고 raw HTML·image·외부 link를 무력화한다.
- 같은 세션의 모델 호출은 하나만 실행하고 호출 중 도착한 window는 다음 batch 하나로 합친다.
- caption handler는 모델을 기다리지 않고 in-memory enqueue까지만 끝낸다.

## 아직 하지 않는 것

- ai-api consumer·lifecycle wiring
