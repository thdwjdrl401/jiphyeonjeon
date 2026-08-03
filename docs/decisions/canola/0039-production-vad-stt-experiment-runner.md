# ADR-0039: STT 비교와 streaming replay는 운영 VAD 기반 단일 실행기로 통합한다

- **상태**: 채택
- **일자**: 2026-08-03
- **관련**: [ADR-0011](0011-realtime-audio-normalization-boundary.md),
  [ADR-0012](0012-realtime-stt-provider-and-overload-boundary.md),
  [ADR-0026](0026-realtime-stt-concurrency-and-batching.md),
  [ADR-0037](0037-ai-roadmap-and-evaluation-gates.md)

## 맥락

`ai/stt-lab`에는 Nemotron·Whisper·vLLM을 같은 manifest와 CER 지표로 실행하는 초기 평가
하네스가 있다. 그러나 현재 local runner는 WAV 전체를 모델에 바로 넣는다. 제품
`realtime-agent`는 전체 WAV를 바로 전사하지 않고 다음 운영 경로를 사용한다.

```text
AudioChunk
  → Pcm16Normalizer(16 kHz mono)
  → VadSegmenter(20 ms frame)
  → SpeechSegment
  → SegmentedStreamingEngine
  → provider delta / authoritative SegmentFinal
```

운영 VAD는 200 ms preroll, 최소 speech 300 ms, silence close 500 ms, 최대 segment 8초를
사용한다. 이 경계는 모델 입력 길이, 문맥 단절, final 지연과 CER에 직접 영향을 준다. 전체 WAV
평가에서 좋은 모델이 실제 VAD segment에서는 나빠질 수 있고, 별도 실험용 VAD를 구현하면 제품과
평가가 서로 다른 조건을 측정한다.

또한 모델별 CLI와 streaming replay를 따로 만들면 audio clock, warmup, decoding 설정, GPU 측정과
report schema가 갈라진다. 모델 선택은 같은 VAD·segment·metric·부하 조건에서 이루어져야 한다.

## 결정

### 1. 제품 VAD를 단일 원본으로 사용한다

실험 코드는 [`VadSegmenter`](../../../ai/realtime-agent/app/audio/segmentation.py)와
`AudioChunk`, `SpeechSegment`, `SegmentedStreamingEngine`의 제품 구현을 import해 사용한다.
실험용 VAD 복사본이나 유사 구현을 만들지 않는다.

기본 replay policy는 현재 운영 기본값을 그대로 사용한다.

| 항목 | 값 |
|---|---:|
| 입력 형식 | PCM16 mono 16 kHz |
| frame | 20 ms |
| preroll | 200 ms |
| 최소 speech | 300 ms |
| silence close | 500 ms |
| 최대 segment | 8,000 ms |

다른 VAD 값을 실험할 수는 있지만 run config에 명시하고 운영 기본값과 별도 결과로 저장한다.
VAD 설정을 바꾼 결과로 모델 우열을 비교할 때는 모든 backend에 같은 설정을 적용한다.

### 2. 비교 실행기와 streaming replay를 하나로 합친다

새 실행기는 manifest의 WAV를 20 ms `AudioChunk`로 만들어 실제 `StreamingSttEngine`에 넣는다.
각 stream은 자기 `VadSegmenter`를 소유하고 다음 두 clock을 동시에 기록한다.

- **audio clock**: sample 수로 계산한 `streamElapsedMs`; CPU scheduling과 무관한 자막 시간축
- **wall clock**: frame 공급, segment 생성, provider delta/final 완료 시각; 실제 지연·backlog 측정

실행 mode는 다음 셋이다.

| mode | frame 공급 | 목적 |
|---|---|---|
| `accuracy` | 대기 없이 20 ms 순서 보존 | 고정 segment에서 CER·용어·숫자 품질 비교 |
| `paced` | 실제 시간에 맞춰 20 ms마다 공급 | speech-start/끝 기준 delta·final 지연과 backlog 측정 |
| `concurrency` | 독립 stream 1/4/12개를 paced replay | 처리량, queue, timeout, drop, GPU 포화 측정 |

세 mode는 같은 frame 생성기와 engine adapter를 사용한다. `accuracy` 결과만으로 실시간성을
판정하거나 `paced` 결과만으로 모델 정확도를 생략하지 않는다.

각 backend run에서 생성된 segment의 `(audio sha256, startMs, endMs, boundaryReason, pcm sha256)`를
`segment-plan.jsonl`에 기록한다. 동일 입력 비교에서 segment plan hash가 다르면 공정한 비교가
아니므로 run을 실패시킨다.

### 3. backend는 같은 segment engine 경계에 연결한다

- Nemotron base와 fine-tuned checkpoint는 현재 `NemotronStreamingEngine` adapter를 사용한다.
- Whisper Transformers와 vLLM은 `SegmentedStreamingEngine`의 provider adapter로 구현하고 같은
  `SpeechSegment`를 받는다.
- Whisper는 native incremental streaming으로 간주하지 않는다. VAD가 닫힌 segment를 전사하고
  provider final 하나를 내는 backend로 측정한다.
- vLLM은 Whisper checkpoint의 serving 방식 비교일 뿐 별도 STT 모델로 집계하지 않는다.
- whole-WAV direct runner는 설치·모델 smoke 용도로만 유지하고 모델 승격 근거에서 제외한다.

실험 실행기는 LiveKit room, Redis caption stream, Spring callback을 호출하지 않는다. 제품 engine의
audio/VAD/provider 경계만 재사용하는 offline opt-in 도구이며 운영 worker를 재시작하지 않는다.

### 4. 지표 정의를 고정한다

정확도 지표는 manifest 정답과 authoritative `SegmentFinal.text`를 clip 순서로 합친 결과를 비교한다.

- raw CER, normalized Korean CER
- 기술용어 recall/F1, 숫자 exact match
- 빈 음성·침묵 hallucination rate
- 누락 segment, 빈 final, 중복 text

streaming 지표는 다음 시점을 구분한다.

- speech-start → first delta
- speech-end → authoritative final
- VAD segment ready → provider first delta/final
- clip 시작 → 완료
- provider RTF, end-to-end RTF, p50/p95/p99
- audio backlog, segment queue depth, frame/segment drop, timeout·오류 수
- cold/warm load, process RSS, GPU used/peak memory·utilization

Nemotron delta와 Whisper final-only를 같은 `firstDeltaMs` 이름만으로 오해하지 않도록 backend capability와
`outputMode=INCREMENTAL|SEGMENT_FINAL_ONLY`를 결과에 기록한다.

### 5. 자동 report를 같은 실행의 artifact로 만든다

한 run은 다음 artifact를 남긴다.

```text
results/<runId>/
├── run.json                 # code/model/dataset/VAD/decoding/hardware/dependency
├── segment-plan.jsonl       # 실제 운영 VAD가 만든 공통 입력 경계
├── samples.jsonl            # clip·segment별 가설, 지표, 지연, 오류
├── summary.json             # 기계 판정 정본
├── comparison.csv           # 스프레드시트용
└── report.md                # 사람이 검토할 비교표와 gate 판정
```

`run.json`에는 code SHA, model revision/checkpoint digest, manifest SHA-256, seed, precision,
decoding config, VAD config, GPU/driver, Python·Torch·Transformers·NeMo/vLLM 버전을 저장한다. secret과
원본 음성은 artifact에 복사하지 않는다.

비교 report는 같은 dataset·segment plan·decoding 조건의 run만 한 표에 넣는다. 조건이 다르면
자동으로 `NOT_COMPARABLE`로 표시하며 평균 하나만 보여주지 않고 percentile과 실패 건수를 함께 남긴다.

### 6. dev와 test 역할을 강제한다

- `golden`: 설치·빠른 회귀 smoke
- `dev`: VAD·decoding·serving·학습 설정 선택
- `test`: 모든 설정과 checkpoint를 고정한 뒤 모델 후보당 최종 1회

실행기는 `test`에 대해 tuning 목적의 여러 config sweep을 기본 거부한다. `test` manifest hash와
실행 이력은 report에 남겨 반복 사용을 드러낸다. 모델 선택 최소 조건은 ADR-0037의 100 clip·60분·8명
speaker-disjoint holdout을 유지한다.

## 구현 순서

1. `ai/stt-lab`에 WAV→20 ms `AudioChunk` replay source를 추가한다.
2. 제품 `VadSegmenter`를 사용하는 segment plan recorder와 hash 검증을 추가한다.
3. Nemotron·Whisper Transformers·vLLM을 `StreamingSttEngine` 경계로 맞춘다.
4. accuracy/paced/concurrency orchestration과 GPU sampler를 추가한다.
5. JSONL 정본에서 JSON·CSV·Markdown report를 생성한다.
6. 합성 speech/silence와 fake backend로 clock·VAD·오류·report를 단위 테스트한 뒤 GPU opt-in E2E를
   실행한다.

## 대안

| 대안 | 판단 |
|---|---|
| 모델마다 별도 CLI와 VAD 구현 | 조건 표류와 지표 불일치 때문에 기각 |
| whole WAV 정확도와 별도 streaming benchmark | 빠르지만 제품 segment 품질을 반영하지 못해 smoke로만 허용 |
| 한 번 VAD로 자른 파일만 모든 모델에 직접 입력 | 공정한 품질 비교는 가능하지만 제품 engine lifecycle·queue를 우회해 보조 분석으로만 허용 |
| 실제 LiveKit room E2E만 사용 | 현실적이지만 재현성과 원인 분리가 낮아 최종 soak gate로만 사용 |
| 제품 VAD와 engine을 import하는 offline replay | 제품 정합·재현성·실험 속도를 함께 확보해 채택 |

## 영향과 검증

- 이 ADR은 실험 도구의 내부 결정이며 Redis payload, Spring API, 공개 상태코드를 바꾸지 않는다.
  따라서 `docs/CONTRACT.md` 변경과 FE/BE 계약 테스트는 필요하지 않다.
- 제품 VAD 기본값이나 `SpeechSegment` 의미가 바뀌면 실험 segment plan hash와 baseline을 다시 만든다.
- 단위 테스트는 20 ms clock, preroll, silence/max-duration/stream-end 경계, backend 동일 plan,
  paced clock, 오류 격리, report deterministic output을 검증한다.
- GPU E2E는 GPU 0만 사용하고 운영 worker와 별도 process에서 실행한다. 종료 후 실험 port·process·VRAM
  반환을 확인한다.
