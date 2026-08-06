# ADR-0085: Whisper 자막은 strict VAD와 EOS·반복 gate를 통과해야 확정한다

- **상태**: 채택
- **일자**: 2026-08-06
- **관련**: [ADR-0044](0044-whisper-vllm-runtime-adapter.md),
  [ADR-0082](0082-realtime-caption-display-text-normalization.md)

## 맥락

기본 Whisper Large V3를 prod realtime-agent에 연결한 실강의에서 실제 발화가 없는 구간에
`감사합니다`, `미리보기`가 생성됐고, 짧은 잡음 뒤에는 `5`가 모델 최대 문맥까지 반복됐다.
기존 공통 VAD는 WebRTC mode 2와 최소 speech 300ms를 사용했으며, vLLM의 비스트리밍 JSON text를 종료
사유 확인 없이 즉시 `SegmentFinal`로 확정했다.

설치된 vLLM 0.11.2의 protocol 타입에는 `verbose_json` segment 품질 지표가 정의돼 있지만 실제
Whisper endpoint는 `text`와 `json`만 허용해 요청을 400으로 거부한다. 따라서
`no_speech_prob`·`avg_logprob`·`compression_ratio`를 현재 런타임에서 신뢰할 수 없다. 반면
streaming transcription SSE의 terminal choice는 정상 EOS 종료를 `finish_reason=stop`, 최대 생성
길이 종료를 `finish_reason=length`로 구분한다.

## 결정

1. 공통 `VadSegmenter` 기본 WebRTC VAD를 가장 엄격한 mode 3으로 변경한다.
2. provider로 전달할 최소 실제 speech 길이를 300ms에서 500ms로 늘린다.
3. vLLM Whisper adapter는 내부적으로 `stream=true`를 사용하되 token delta를 외부에 발행하지 않고
   한 VAD segment의 text를 끝까지 모은다.
4. terminal `finish_reason=stop`만 EOS 정상 종료로 인정한다. `length`, terminal 누락과 알 수 없는
   종료 사유는 Redis caption으로 발행하지 않고 길이와 종료 사유만 warning log로 남긴다.
5. 공백을 정규화한 출력에서 길이 1~24자의 동일 단위가 네 번 이상 연속되고 그 반복 구간이 전체
   출력의 60% 이상이면 병적 반복으로 판단해 segment 전체를 폐기한다. 원문 text는 log에 남기지 않는다.
6. 정상 통과한 text만 기존 `TextDelta → SegmentFinal → Redis` 계약으로 전달한다. Redis schema와
   Spring consumer는 변경하지 않는다.

## 영향

- 짧은 잡음이 Whisper 호출로 이어지는 빈도가 줄고, EOS 없이 토큰 한도까지 반복된 결과는 자막에
  나타나지 않는다.
- 500ms보다 짧은 실제 감탄사와 짧은 대답은 누락될 수 있다. 강사 강의 자막에서 무음 환각 억제를 더
  높은 우선순위로 둔다.
- `감사합니다` 같은 자연어 blacklist는 사용하지 않으므로 실제 강사 발화는 문자열만으로 삭제하지 않는다.
- 향후 runtime이 `verbose_json`을 실제 지원하면 동일 고정 평가에서
  `no_speech_prob`·`avg_logprob`·`compression_ratio` gate를 추가 비교한다.

## 검증

- 기본 VAD가 480ms speech를 버리고 500ms speech를 확정하는 단위 테스트를 둔다.
- 정상 `stop` 응답은 기존 delta/final 계약을 유지한다.
- 숫자 및 구절 반복과 `length` 종료가 `SegmentFinal`을 만들지 않는 단위 테스트를 둔다.
- 실제 강의 무음·잡음 샘플과 정상 발화로 Redis E2E를 재검증한다.
