# ADR-0011: realtime 오디오 정규화를 stream 단위 primitive로 분리

- **상태**: 채택
- **일자**: 2026-07-27
- **관련**: [ADR-0009](0009-realtime-agent-core-boundary.md),
  [ADR-0010](0010-realtime-agent-room-job-boundary.md)

## 맥락

원본 `feat/ai/mvp-service-scaffold`의 `ab3f28b`은 PCM16 mono downmix와 sample-rate 변환을
VAD segmentation과 같은 변경에 포함한다. 정규화는 provider에 종속되지 않지만 VAD의 frame,
padding, 최소·최대 발화 길이와 silence close 값은 별도 정책이다.

원본 함수는 `audioop.ratecv(..., state=None)`을 chunk마다 호출한다. LiveKit의 48 kHz 고정 20 ms
frame처럼 변환 비율에 맞는 경계에서는 드러나지 않지만, 비정렬 chunk에서는 리샘플러가 매번
초기화되어 전체 PCM을 한 번에 변환한 결과와 달라질 수 있다.

## 결정

이 기록은 `realtime-stt-providers` MR 내부의 정규화 계층만 다음과 같이 한정한다.

1. target sample rate의 PCM16 mono는 그대로 유지한다.
2. PCM16 stereo는 좌우 채널을 같은 비율로 mono downmix한다.
3. stream마다 `Pcm16Normalizer` 인스턴스를 두고 고정 target sample rate의 변환 상태를 chunk
   사이에 보존한다.
4. 불완전한 PCM16 frame, 지원하지 않는 channel 수와 stream 도중 source sample rate 변경은
   즉시 거부한다.

정규화 primitive 자체에는 VAD, 20 ms framing, 발화 segmentation, STT provider·registry,
room job wiring, queue backlog 정책을 섞지 않는다. 이 중 VAD·provider·backlog 정책은 같은
`realtime-stt-providers` MR의 별도 계층에서 다루고, backend와 공용 계약은 바꾸지 않는다.

## 영향

- 이 primitive만으로는 실제 room audio 경로의 출력 형식이 바뀌지 않는다.
- 테스트는 mono 유지, stereo downmix, 48 kHz → 16 kHz 변환, PCM frame·channel 거부뿐 아니라
  비정렬 연속 chunk 변환이 합친 PCM의 일괄 변환과 같은지도 검증한다.
- Python 3.12에서는 표준 라이브러리 `audioop`을 사용한다. 이 모듈은 Python 3.13에서 제거되므로
  런타임 업그레이드 전에 LiveKit SDK resampler 등 대체 구현을 별도 결정해야 한다.
- VAD의 frame 크기와 발화 경계는 같은 provider MR의
  [ADR-0012](0012-realtime-stt-provider-and-overload-boundary.md)에서 독립적으로 결정하고 테스트한다.
