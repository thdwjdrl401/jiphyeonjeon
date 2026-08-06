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

1. 공통 `VadSegmenter` 기본 WebRTC VAD는 가장 엄격한 mode 3을 사용하고, 공통 최대 연속 발화를 15초로
   제한한다. Nemotron의 기존 500ms 최소 speech와 500ms 무음 종료 정책은 유지한다.
2. `vllm-whisper` adapter만 연속 speech 120ms가 확인된 뒤 segment를 활성화한다. 200ms pre-roll은
   유지해 첫 음절을 보존한다. 최소 실제 speech는 900ms, segment 전체 frame 중 speech 비율은 50%,
   무음 종료는 700ms로 설정한다. 다른 provider에는 이 정밀도 우선 임계값을 적용하지 않는다.
3. vLLM Whisper adapter는 내부적으로 `stream=true`를 사용하되 token delta를 외부에 발행하지 않고
   한 VAD segment의 text를 끝까지 모은다.
4. terminal `finish_reason=stop`만 EOS 정상 종료로 인정한다. `length`, terminal 누락과 알 수 없는
   종료 사유는 Redis caption으로 발행하지 않고 길이와 종료 사유만 warning log로 남긴다.
5. 공백을 정규화한 출력에서 길이 1~24자의 동일 단위가 네 번 이상 연속되고 그 반복 구간이 전체
   출력의 60% 이상이면 병적 반복으로 판단해 segment 전체를 폐기한다. 원문 text는 log에 남기지 않는다.
6. 확정 후보 text의 UTF-8 zlib 압축률이 2.4를 초과하거나, segment 오디오 1초당 공백 제외 문자가
   8자를 초과하거나, 정규화 후 직전 final과 같은 연속 출력이면 폐기한다. zlib 값은 vLLM이 제공하는
   Whisper 모델 지표가 아니라 adapter가 text에서 직접 계산한다.
7. segment마다 `speech_ms`, `segment_ms`, `speech_ratio`, speech frame의 `mean_rms_dbfs`, 경계 원인과
   출력 gate 지표를 기록한다. RMS는 실제 녹음 분포로 임계값을 보정하기 전에는 폐기 조건으로 쓰지 않는다.
8. 정상 통과한 text만 기존 `TextDelta → SegmentFinal → Redis` 계약으로 전달한다. Redis schema와
   Spring consumer는 변경하지 않는다.

## 영향

- 산발적인 잡음 frame과 speech 밀도가 낮은 segment가 Whisper 호출로 이어지는 빈도가 줄고, EOS 없이
  토큰 한도까지 반복되거나 오디오 길이에 비해 비정상적으로 긴 결과는 자막에 나타나지 않는다.
- 900ms보다 짧은 실제 감탄사와 짧은 대답은 누락될 수 있다. 강사 강의 자막에서 무음 환각 억제를 더
  높은 우선순위로 둔다.
- 700ms 무음 종료는 기존보다 자막 확정을 200ms 늦출 수 있고, 15초 연속 발화는 provider 입력과 최악
  확정 지연을 늘린다. 일반 발화는 무음 경계에서 먼저 닫히므로 항상 15초를 기다리지는 않는다.
- `감사합니다` 같은 자연어 blacklist는 사용하지 않으므로 실제 강사 발화는 문자열만으로 삭제하지 않는다.
- 직전 final과 실제로 같은 문장을 연속 발화한 경우 두 번째 문장은 누락될 수 있다. 자막의 downstream
  영속·RAG 오염 비용을 중복 누락보다 높게 본다.
- 향후 runtime이 `verbose_json`을 실제 지원하면 동일 고정 평가에서 `no_speech_prob`·`avg_logprob`와
  모델 계산 `compression_ratio` gate를 추가 비교한다.

## 검증

- 기본 VAD가 120ms 연속 speech에서만 활성화되고, 900ms 미만 발화와 speech 비율 50% 미만 segment를
  버리며, 연속 발화를 15초에서 강제 분할하는 단위 테스트를 둔다.
- 정상 `stop` 응답은 기존 delta/final 계약을 유지한다.
- 숫자·구절 반복, `length` 종료, 비정상 출력 밀도와 연속 동일 final이 `SegmentFinal`을 만들지 않는
  단위 테스트를 둔다.
- 실제 강의 무음·잡음 샘플과 정상 발화로 Redis E2E를 재검증한다.
