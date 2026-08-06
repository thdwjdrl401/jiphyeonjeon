# Audio processing

## 역할

LiveKit에서 받은 PCM 오디오를 STT provider가 소비할 수 있는 형식과 구간으로 변환한다.

## 구조와 흐름

입력 frame을 공통 PCM 형식으로 정규화한 뒤 provider 특성에 따라 연속 stream 또는 발화 segment로 넘긴다.

## 파일 구성

- `normalizer.py`: PCM16 입력의 sample rate·channel을 정규화
- `segmentation.py`: 무음 기준 발화 구간 분할

## 경계와 불변식

오디오 처리는 transport나 자막 저장 형식을 알지 않는다. VAD segment의 start/end는 pre-roll과 trailing
silence가 아니라 실제 첫/마지막 speech frame이다. 경계 원인은 `SILENCE`, 8초 강제 `MAX_DURATION`, 종료
drain의 `STREAM_END`다. 불완전 frame과 최대 구간 길이를 제한해 메모리와 지연이 무한히 늘지 않게 한다.
기본 WebRTC VAD는 가장 엄격한 mode 3을 사용하며, 실제 speech frame이 500ms 미만인 구간은 STT provider로
전달하지 않는다. 이는 Whisper가 짧은 잡음과 무음에 그럴듯한 문장을 생성하는 비음성 환각을 줄이기 위한
운영 기본값이다.

## 검증

`tests/test_audio_normalizer.py`, `tests/test_audio_segmentation.py`에서 변환 결과와 경계값을 검증한다.
