# ADR-0012: realtime STT provider와 오디오 과부하 경계를 함께 고정

- **상태**: 채택
- **일자**: 2026-07-27
- **관련**: [ADR-0009](0009-realtime-agent-core-boundary.md),
  [ADR-0010](0010-realtime-agent-room-job-boundary.md),
  [ADR-0011](0011-realtime-audio-normalization-boundary.md)

## 맥락

원본 `feat/ai/mvp-service-scaffold`의 `7d78fdf`, `2d3c875`, `ab3f28b`은 VAD와 OpenAI,
Nemotron provider를 도입하지만 현재 core와 다른 engine 필드를 사용하고 Redis·config 변경 및 큰
lockfile과 섞여 있다. 원본 VAD는 최대 길이를 실제 segment 시간이 아닌 speech 누적 시간으로
계산하고, provider가 느릴 때 LiveKit SDK의 기본 무제한 queue로 backlog가 이동한다.

OpenAI와 Transformers API도 원본 이후 변경됐다. 현재 OpenAI 문서는 transcription session에
`gpt-realtime-whisper`, 24 kHz mono PCM, 수동 commit을 사용한다. Nemotron 3.5 ASR은
Transformers 5.13에 추가됐고 streaming API가 experimental이라고 명시한다.

## 결정

이번 단계는 계획의 `realtime-stt-providers` 한 기능 단위로 다음을 선별 이식한다.

1. `VadSegmenter`는 16 kHz mono PCM을 20 ms frame으로 처리한다. 발화 시작 preroll은
   200 ms, 최소 speech는 잠정 300 ms, 최대 segment는 silence와 preroll을 포함한 실제 PCM 8초,
   silence close는 500 ms다. append-only 자막에서 중복을 만들지 않도록 강제 분할 경계에는
   overlap을 재전사하지 않는다. 기존 1,000 ms 문서는 실험 예정값이므로 채택값으로 보지 않는다.
2. segment queue는 8개, engine event queue는 64개로 제한하고 생산자를 await시켜 backpressure를
   전달한다. segment 완료 시 provider, segment 길이, provider iterator 대기 시간과 남은 queue
   depth를 DEBUG 로그로 남긴다.
3. LiveKit `AudioStream`은 20 ms frame을 사용하되 SDK `capacity`는 기본값 0으로 둔다. SDK의
   유한 ring queue는 오래된 frame을 알림 없이 제거하기 때문이다. 대신 자체 queue를 250 frame,
   약 5초로 제한하고 초과 시 drop 없이 `AudioBacklogError`로 실패한다. 이때 track, queue 크기,
   capacity와 backlog ms를 ERROR 로그로 남긴다. 5초는 LiveKit capture queue의 한계이며, 최대 8초
   segment 8개를 보관하는 provider queue까지 합친 전체 pipeline latency 상한을 뜻하지 않는다.
4. OpenAI adapter는 [공식 Realtime transcription 가이드](https://developers.openai.com/api/docs/guides/realtime-transcription)에
   맞춰 WebSocket `intent=transcription`, `session.type=transcription`, 24 kHz PCM,
   `turn_detection=null`, 수동 append/commit과 `itemId`별 delta/completed/failed 처리를 사용한다.
   transcription model은 URL의 top-level realtime model query가 아니라 session payload에 둔다. 이미
   발행한 delta와 final transcript가 갈라져도 수정 기능이 없는 현재 append-only event 계약에서는
   job을 실패시키거나 교정 문자열을 뒤에 중복 발행하지 않고 이미 발행한 realtime delta를 보존한다.
   공백 정규화 이상의 차이는 transcript 원문 없이 길이만 WARNING으로 남긴다.
5. Nemotron adapter는
   [Transformers 5.13의 공식 streaming 예제](https://huggingface.co/docs/transformers/v5.13.1/en/model_doc/nemotron3_5_asr#streaming-transcription)를
   기준으로 lazy load하고 segment 추론을 직렬화한다. thread producer는 async queue에서 blocking
   wait하지 않으며 모델·iterator 오류를 consumer에 전달한다. 종료 시 stop event를 Transformers
   stopping criteria와 50 ms streamer poll에 전달하고 generation join은 총 0.5초로 제한한다.
6. registry와 provider 생성자까지만 제공한다. 환경 변수, `AgentServer`, room job provider 선택,
   Redis와 caption wiring은 후속 lifecycle MR로 남긴다.

따라서 backend, `docs/CONTRACT.md`와 Java/Spring 코드는 변경하지 않는다. 원본 lockfile도 가져오지
않고 현재 `livekit-agents==1.6.6` 위에서 필요한 base 의존성과 `nemotron` extra만 다시 고정한다.

## 영향과 검증 한계

- fake WebSocket·fake recognizer 및 CPU VAD로 session payload, delta 순서, 오류·timeout·취소,
  segment 경계와 queue overflow를 단위 테스트한다.
- 2026-07-28 실제 OpenAI key를 `uv --env-file`로 process에만 주입해 Models API 200과 transcription
  session update를 확인했다. 기존 top-level model query는 `invalid_model`이었고
  `intent=transcription`으로 교정한 뒤 개인정보 없는 500 ms 합성 톤 1회가 completion을 받았다.
  이는 API 연결 smoke이며 실제 발화 품질이나 LiveKit room E2E를 대체하지 않는다.
- 2026-07-28 기존 LiveKit room에 임의 lesson UUID로 실제 dispatch한 E2E에서 OpenAI delta 6개가
  Redis Stream에 strict UTF-8로 적재됐지만, completed transcript가 누적 delta와 달라 job이
  실패하는 것을 확인했다. OpenAI 문서는 completed transcript가 누적 delta의 byte-for-byte prefix라는
  불변식을 보장하지 않으므로, 위 append-only 보존 정책과 회귀 테스트를 채택했다.
- 기본 테스트에서는 Nemotron CUDA extra와 모델 가중치를 설치하지 않는다. 실제 RTX/CUDA에서의
  VRAM, latency, 품질과 Transformers experimental API 호환성은 별도 GPU smoke가 필요하다.
- model instance는 engine 안에서 lazy load된다. runnable process에서 job마다 모델을 중복 생성하면
  GPU OOM 위험이 있으므로 lifecycle wiring 전에 process-wide sharing 정책을 정해야 한다.
- CUDA 연산이 stopping criteria를 영구적으로 확인하지 않는 driver/model hang은 Python에서 thread를
  강제 종료할 수 없다. 이 경우 consumer와 close는 제한 시간 안에 돌아오고 late state assignment는
  차단하지만 daemon generation thread는 process 종료 전까지 남을 수 있다.
- Python 3.13 전에는 deprecated `audioop` resampling을 교체해야 한다.
