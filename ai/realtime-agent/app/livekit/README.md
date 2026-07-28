# LiveKit boundary

## 역할

LiveKit room의 remote microphone track을 선택해 bounded PCM stream으로 application에 제공한다.

## 구조와 흐름

subscription이 publisher와 track 이벤트를 감시해 허용된 microphone 하나를 고르고, audio source가 frame을
20 ms 단위로 읽어 room job에 전달한다.

## 파일 구성

- `subscription.py`: publisher·track 선택과 중복 microphone 방어
- `audio_source.py`: LiveKit frame 수신과 bounded queue
- `rtc_config.py`: 선택적인 coturn REST credential과 relay-only ICE 설정

## 경계와 불변식

같은 publisher의 여러 microphone track 중 하나만 선택하고 두 번째 microphone publisher는 fail-closed 처리한다.
queue가 가득 차면 frame을 조용히 버리지 않고 `AudioBacklogError`로 job을 실패시킨다.
TURN을 설정하지 않으면 SDK 기본 ICE를 유지한다. TURN TCP tunnel을 사용할 때는 LiveKit API secret과
분리한 `LIVEKIT_TURN_SECRET`으로 단기 credential을 만들고 relay-only RTC 설정을 명시적으로 주입한다.

## 검증

`tests/test_subscription.py`, `tests/test_livekit_audio_source.py`, `tests/test_rtc_config.py`에서 선택 규칙,
backlog와 RTC 설정을 검증한다.
