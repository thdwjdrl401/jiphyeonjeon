# ADR-0082: realtime 자막 표시 텍스트는 application Redis 직전에 한 번 정규화한다

- **상태**: 채택
- **일자**: 2026-08-03
- **관련**: [ADR-0025](0025-realtime-agent-spring-handoff-contract.md),
  [ADR-0042](0042-replay-ai-caption-context-contract.md),
  [ADR-0044](0044-whisper-vllm-runtime-adapter.md)

## 맥락

Whisper Large V3는 대화 자막 학습 형식의 dash와 웃음 소리의 반복 자모를 발화 텍스트로 생성할 수
있다. 이는 신뢰할 수 있는 speaker diarization이 아니며 강사 한 명의 microphone track을 자막화하는
현재 제품에서는 표시 노이즈다. Nemotron과 OpenAI Realtime도 provider 고유 형식이나 반복 문자를 낼 수
있으므로 한 provider adapter에서만 제거하면 환경별 자막 계약이 달라진다.

Spring과 Frontend에서 같은 규칙을 반복하면 Redis 영속본, WebSocket 표시본과 VOD 권위 자막이 서로
달라질 수 있다. 반대로 학습·평가 transcript 자체를 바꾸면 raw CER와 model error 분석 근거를 잃는다.

## 결정

### 1. 정규화 경계는 CaptionEventMapper로 고정한다

STT engine event는 원문을 유지한다. CaptionEventMapper가 CaptionDelta와 CaptionSegmentFinal 계약
객체를 만들기 직전에 provider-neutral CaptionTextNormalizer를 적용한다. Redis publisher는 이미
정규화된 계약 객체를 직렬화할 뿐 text를 다시 변경하지 않는다.

### 2. 첫 정책은 표시 노이즈만 결정적으로 제거한다

- Unicode category Pd의 모든 dash와 soft hyphen, minus sign, small/fullwidth hyphen을 단어 경계
  공백으로 바꾼다.
- Hangul compatibility jamo ㅋ·ㅎ과 같은 choseong ᄏ·ᄒ을 제거한다.
- 괄호형 웃음 marker인 (웃음), [웃음]과 대응하는 전각 괄호 변형을 제거한다.
- 결과의 연속 공백은 하나의 단어 경계로 합치고 발화 final의 앞뒤 공백을 제거한다.
- 맞춤법 교정, 문장부호 재작성, 화자 추정, 의미 요약과 LLM 후처리는 하지 않는다.

dash를 전부 제거하므로 음수, 범위와 hyphenated term의 원래 표기는 보존되지 않는다. 강의 자막의
화자 표기 노이즈 제거를 우선한다는 제품 결정을 명시적으로 수용한다.

### 3. append-only Redis 순번을 보존한다

정규화 결과가 빈 TextDelta면 XADD하지 않고 sequence도 증가시키지 않는다. 한 VAD segment의 delta와
final이 모두 비면 CaptionSegmentFinal과 segmentIndex도 만들지 않는다. delta가 모두 제거됐지만
권위 final에 정상 문장이 남으면 그 final 전체를 CaptionDelta 한 번으로 먼저 발행한 뒤 같은
CaptionSegmentFinal로 확정한다.

필터된 event의 stream clock은 내부적으로 계속 전진하며 CaptionStreamCompleted의 streamElapsedMs는
실제 전체 audio 시간을 유지한다. Redis schema, contractVersion과 Spring DTO는 바꾸지 않는다.

### 4. 학습·평가 원문과 모델 출력은 보존한다

AIHub 원문, 학습 label, STT lab per-sample output과 raw/normalized CER 계산에는 이 표시 정규화기를
적용하지 않는다. 운영 application Redis에 전달되는 display transcript만 정규화한다. 원문 강의
transcript를 별도 저장하거나 로그에 남기는 기능은 이 결정에 포함하지 않는다.

## 영향

- Nemotron, vLLM Whisper와 OpenAI Realtime이 같은 표시 텍스트 정책을 사용한다.
- 웃음이나 dash뿐인 구간은 Redis와 Spring/Frontend에 나타나지 않는다.
- 정규화된 delta sequence는 gapless이고 final의 lastSequence 계약을 유지한다.
- 실제 화자 구분이 필요하면 별도 diarization 모델과 계약이 필요하며 dash 출력은 근거로 사용하지 않는다.

## 검증

- Unicode dash, 반복 자모, 괄호형 웃음 marker와 split delta 경계를 pure unit test로 고정한다.
- 빈 delta·빈 segment의 sequence/segmentIndex 미소비와 final-only fallback을 pipeline test로 고정한다.
- 실제 LiveKit audio를 vLLM Whisper에 보내 Redis의 delta/final text와 gapless sequence를 확인한다.
