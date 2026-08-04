# ADR-0044: Qwen3-ASR 1.7B를 한국어 강의 fine-tuning 1순위 후보로 선택한다

- **상태**: 채택
- **일자**: 2026-08-03
- **관련**: [ADR-0037](0037-ai-roadmap-and-evaluation-gates.md),
  [ADR-0039](0039-production-vad-stt-experiment-runner.md),
  [ADR-0040](0040-stt-fine-tuning-dry-run-and-promotion.md),
  [ADR-0041](0041-aihub-dual-transcription-evaluation.md),
  [ADR-0042](0042-whisper-vllm-runtime-adapter.md)

## 맥락

기존 STT 후보 탐색은 이미 연결된 Nemotron과 범용 대안 Whisper를 먼저 비교하는 범위로 고정했고,
후보군을 다시 탐색하는 gate를 두지 않았다. 그 결과 한국어와 streaming을 지원하는 Qwen3-ASR를
ADR-0041 기준선에 포함하지 못했다. 이는 Qwen이 요구사항에 맞지 않아서 제외한 결정이 아니라 후보
탐색 범위를 일찍 닫은 과정상의 누락이다.

[Qwen3-ASR 공식 저장소](https://github.com/QwenLM/Qwen3-ASR)와 공식 model card에 따르면 ASR
후보는 0.6B와 1.7B 두 개이고, 별도 0.6B ForcedAligner는 주어진 transcript의 timestamp를 정렬하는
모델이지 ASR 후보가 아니다. 두 ASR 모델은 Korean을 포함한 30개 언어, offline과 streaming
inference, Apache-2.0 라이선스를 지원한다.

공식 공개 benchmark도 1.7B가 0.6B보다 일관되게 정확하다.

| 공식 open ASR 지표 | Qwen3-ASR 0.6B | Qwen3-ASR 1.7B |
|---|---:|---:|
| MLS WER | 13.19 | 8.55 |
| CommonVoice WER | 12.75 | 9.18 |
| MLC-SLM WER | 15.84 | 12.74 |
| Fleurs WER | 7.57 | 4.90 |

다만 범용 공개 benchmark만으로 한국어 교육 강의와 현재 VAD pipeline 적합성을 결정할 수 없다.
따라서 ADR-0041과 같은 AI Hub 고정 dev 표본으로 두 크기를 직접 비교한다.

## 실험

### 공통 조건

| 항목 | 값 |
|---|---|
| manifest | `dev-benchmark-502.jsonl` |
| manifest SHA-256 | `51d91b3d6316b762e5df6ed3c235cb94e462cfa0465d8dc95131f18227839f44` |
| 표본 | 502 clips, 8 speakers, 9 lectures, 4,435,071 ms |
| 공통 VAD | 904 segments, 16 kHz, 20 ms frame, max 8,000 ms |
| 실행 | GPU 0, accuracy mode, worker 1 |
| Qwen serving | `qwen-asr==0.0.6`, `vllm==0.14.0`, BF16, loopback `:18084` |
| Qwen streaming | 공식 `start/chunk/finish` API, 입력 chunk 500 ms |

Qwen replay adapter도 다른 후보와 같은 제품 `VadSegmenter` 결과를 사용한다. 다만 현재 제품은
VAD가 segment를 확정한 뒤 Qwen API에 500 ms씩 재생한다. 아래 RTF와 CER는 정확도·서버 처리
비교에는 유효하지만 발화 시작 시점부터의 end-to-end streaming latency는 아니다.

vLLM 내부 tokenizer는 `fix_mistral_regex=True`를 권고하는 경고를 출력했다. 설치된 공식
`qwen-asr==0.0.6` processor는 이미 이 옵션을 명시한다. 추가로 고정 manifest의 reference와
Qwen prompt 8,888개를 기본 tokenizer와 fix tokenizer로 각각 encode했으며 token ID가 달라진
문장은 0건이었다. 따라서 이 한국어 결과는 유효하게 사용하되 production runtime에서도 fixed
processor를 명시하고 경고를 회귀 검사한다.

### 결과

| 후보 | 출력 경로 | multi-ref CER | literal CER | mean RTF | missing final |
|---|---|---:|---:|---:|---:|
| Nemotron 3.5 ASR Streaming 0.6B | in-process incremental | 23.9964% | 28.1089% | 0.05690 | 83 |
| Whisper Large V3 BF16 | in-process VAD final | 16.1193% | 20.2342% | 0.09039 | 0 |
| Qwen3-ASR 0.6B BF16 | external vLLM streaming | 17.9942% | 22.0820% | 0.03166 | 9 |
| **Qwen3-ASR 1.7B BF16** | external vLLM streaming | **14.6870%** | **18.9017%** | **0.04120** | **10** |

Qwen3-ASR 1.7B의 multi-ref CER는 Qwen 0.6B보다 상대 18.38%, Whisper Large V3보다 상대
8.89% 낮다. 이 고정 dev 표본에서는 현재 정확도 1위다. RTF는 Whisper의 약 0.456배지만 Qwen은
외부의 이미 warm된 vLLM process이고 Whisper 기준선은 in-process이므로 이 값만으로 처리량 우위를
확정하지 않는다.

외부 server의 CUDA memory는 replay process peak에 잡히지 않는다. `nvidia-smi` 실측에서
Qwen 0.6B engine은 19,010 MiB, 1.7B engine은 23,138 MiB를 점유했다. 이는
`gpu_memory_utilization`에 따른 KV cache 예약을 포함해 in-process peak reserved와 직접 비교할
수 없다.

1.7B의 missing final 10건은 9개 clip에서 발생했다. 대부분 8초 max-duration 뒤에 남은
400~740 ms tail 또는 짧은 silence segment였고 clip 전체 hypothesis에는 앞 구간에서 완성된 문장이
많았다. 그러나 현재 운영 gate는 모든 VAD segment의 final을 요구하므로 이를 정상으로 면제하지
않는다.

### missing final 원인 진단

공식 SFT collator는 prefix와 target을 합칠 때 `tokenizer.eos_token`을 target 뒤에 추가하고,
prefix와 padding만 `-100`으로 masking한다. 따라서 EOS도 loss 대상이다. Qwen3-ASR는
Whisper처럼 autoregressive decoder가 finite utterance의 생성을 EOS로 닫지만, 이 EOS를
VAD endpoint detector로 사용해야 한다는 뜻은 아니다.

공식 `ASRStreamingState`는 “single utterance” 상태다. 새 audio chunk가 준비될 때마다 stream
시작부터 누적된 audio를 다시 decode하고, 마지막 일부 token을 rollback한 뒤 안정 prefix를
유지한다. `finish_streaming_transcribe`는 1초보다 짧게 남은 buffer도 decode한다. 즉 현재
missing final은 tail flush가 호출되지 않은 문제가 아니라, 독립 utterance가 된 짧은 tail에서
모델이 곧바로 EOS를 선택해 빈 text를 반환한 현상이다.

실패한 10개 segment를 같은 1.7B·공식 `start/chunk/finish` API로 다시 실행했다.

| 입력 조건 | non-empty final |
|---|---:|
| 400~740 ms tail 단독 | 0/10 |
| tail + 왼쪽 문맥 1초 | 8/10 |
| 직전 VAD segment 시작부터 tail까지 | 9/10 |

tail 단독 조건은 중간 text도 0/10이었다. 평균 WebRTC VAD voiced-frame 비율은 0.7503이지만
평균 RMS는 -54.632 dBFS로 매우 작았고, 2건은 voiced-frame 비율도 0이었다. 마지막 1건은 직전
segment 문맥을 붙여도 빈 결과라 VAD false positive 또는 비언어 음성으로 판단한다.

따라서 주원인은 **EOS 학습 누락이 아니라 provider와 VAD의 session 경계 불일치**다. 8초
`MAX_DURATION` 뒤 400~740 ms 잔여음을 새 Qwen utterance로 만들고, silence 경계의 짧고 약한
음성도 무조건 독립 provider final로 요구했다. fine-tuning으로 이런 조각에 text를 강제하면
무음·비언어 음성 hallucination을 늘릴 수 있으므로 학습 데이터 보강만으로 해결하지 않는다.

참고로 후보 탐색 중 전체 dev 4,444 clips·8,117 segments도 Qwen 0.6B로 추가 실행했다. multi-ref
CER 20.8009%, mean RTF 0.03399, missing final 73이었지만 다른 후보의 같은 전체-dev 결과가 없으므로
모델 선택 표에는 사용하지 않는다.

## 결정

### 1. Qwen3-ASR 1.7B를 fine-tuning 1순위로 선택한다

한국어 강의 base CER가 가장 낮고, 0.6B 대비 정확도 개선이 명확하며, 현재 H200 GPU 0에서
Whisper·BGE와 함께 모델을 적재한 실험도 가능했다. 0.6B는 memory와 latency가 반드시 더 중요한
fallback 후보로만 유지한다.

이 결정은 “운영 즉시 교체”가 아니다. 1.7B도 missing final gate를 통과하지 못했고 paced·동시성·
LiveKit canary가 남아 있으므로 현재 운영 provider 기본값은 자동 변경하지 않는다.

### 2. 첫 학습은 공식 full-parameter SFT recipe를 사용한다

[Qwen 공식 fine-tuning recipe](https://github.com/QwenLM/Qwen3-ASR/tree/main/finetuning)는
JSONL의 `audio`와 `text`를 입력으로 받고, Korean target은
`language Korean<asr_text>{transcript}` 형식을 사용한다. 현재 AI Hub manifest의 원본 utterance
WAV와 철자 전사 `trainingReference`를 이 형식으로 export한다.

- 기존 train만 화자-강의 연결 컴포넌트 단위로 SFT train/internal-eval로 다시 나눈다.
- 기존 dev·고정 502 benchmark·test·golden은 학습과 hyperparameter 선택에서 보호한다.
- 정렬된 label이 없으므로 운영 VAD segment에 전체 문장 label을 붙여 학습하지 않는다.
- 첫 pilot은 BF16 full SFT로 고정하고 LoRA와 hyperparameter sweep을 동시에 진행하지 않는다.
- checkpoint는 processor/tokenizer/config/weight를 함께 저장해 standalone load가 가능해야 한다.

#### 실제 학습 입력과 GPU smoke

seed 37 export는 원본 train 31,296 clips·76.567시간을 다음처럼 나눴다. 컴포넌트 제약 때문에
요청한 10%와 정확히 같지는 않지만, 무작위 clip 분할로 화자·강의가 새는 것보다 격리를 우선한다.

| 구분 | clips | 시간 | 화자 | 강의 | JSONL SHA-256 |
|---|---:|---:|---:|---:|---|
| SFT train | 28,026 | 67.844h | 57 | 77 | `599c4fe40bcd4c6a8a7be457ca9b6de0d35f4fe34c9d5c0533301c7e9fe729d9` |
| internal eval | 3,270 | 8.723h | 7 | 9 | `6fb74c20df7bd6b3356cee156af6e9698243bbffc26db538139ca3976f77520b` |

기존 dev·502 benchmark·test·golden과 clip ID, audio path, speaker ID, lecture ID뿐 아니라 실제
WAV content SHA-256도 전부 교집합 0이다. export target에는 EOS를 넣지 않고, official collator가
EOS를 한 번만 추가한다.

rootless 전용 venv(`qwen-asr==0.0.6`, `datasets==4.0.0`, PyTorch 2.11.0+cu128)와 GPU 0
제약 runner를 만들었다. 2 train samples·1 eval sample·1 optimizer step BF16 full SFT smoke는
loss 1.7545로 끝났고, inferable `checkpoint-1`, optimizer state, standalone `final/`,
processor/tokenizer/config와 `eosSupervised=true` provenance 저장을 확인했다. 이는 학습 pipeline
실행 증거이며 정확도 개선 증거는 아니다.

최신 vLLM의 offline Qwen3-ASR 경로는 LoRA를 지원하지만 realtime architecture의 LoRA 지원은
공식 표에서 확인되지 않았다. 따라서 첫 realtime 승격 경로는 full checkpoint다. 이후 LoRA를
실험하면 serving 전에 standalone full checkpoint로 merge하고 동일 replay를 다시 통과해야 한다.

### 3. serving은 공식 Qwen vLLM backend를 별도 model owner로 둔다

Qwen3-ASR streaming은 공식 `qwen-asr` package의 vLLM backend로 검증한다. realtime-agent와
모델 process를 분리하고 GPU 0, loopback bind, 명시적 model path를 강제한다.

`qwen-asr-demo-streaming` Flask server는 운영에 사용하지 않는다. 운영 runtime은 Qwen architecture를
등록하는 `qwen-asr-serve`와 vLLM 0.14.0을 loopback에서 사용하고 `/v1/models`로 readiness를
확인한다. fine-tuned checkpoint는 동일 runtime에서 load되고 replay gate를 통과한 뒤 승격한다.

운영 adapter는 공통 VAD가 확정한 최대 8초 WAV segment를 OpenAI 호환
`/v1/audio/transcriptions`에 전송한다. 이는 Qwen 전용 realtime WebSocket이 아니므로 segment 간
provider context는 유지되지 않는다. missing-final과 문맥 품질이 운영 gate를 통과하지 못하면 후속으로
Qwen streaming session adapter와 overlap·text de-duplication을 도입한다.

### 4. fine-tuned checkpoint 승격 gate를 고정한다

- 고정 dev multi-ref CER: base 14.6870% 대비 상대 10% 이상 개선, 즉 **13.2183% 이하**
- 일반 한국어 holdout: base 대비 절대 2%p 초과 악화 금지
- missing final, warning, timeout, frame/segment drop: 모두 0
- paced concurrency 1/4/12: OOM 0, backlog·p95 latency 예산 통과
- 설정 고정 후 test split 최종 1회
- LiveKit audio → Qwen runtime → Redis caption canary 통과

## 2026-08-04 운영 스위칭 결정

사용자 승인으로 GPU 0에서 dev는 Nemotron 1 process, prod는 Qwen3-ASR 1.7B base vLLM
runtime 1 process로 운영 canary를 시작한다. 실패한 full-SFT final은 모든 weight가 non-finite라
승격하지 않고 `Qwen/Qwen3-ASR-1.7B` base checkpoint만 사용한다.

Qwen3-ASR vLLM 0.14.0은 기존 adapter와 같은 `POST /v1/audio/transcriptions`를 지원하므로
별도 provider를 복제하지 않는다. runtime은 모델 architecture를 등록하는 `qwen-asr-serve`로 띄우고,
기존 segmented VAD·Redis caption 계약을 재사용한다. 실제 응답의
`language Korean<asr_text>` envelope는 adapter 경계에서 제거한다.

운영 smoke에서 `/v1/models` exact alias, AI Hub eval WAV transcription, prod/dev health readiness를
검증했다. GPU 0 점유는 Qwen 약 14.1 GiB, Nemotron 약 3.0 GiB였다. 이 canary는 앞서 정한
품질·동시성 승격 gate를 폐기하지 않으며, fine-tuned checkpoint는 gate 통과 후 별도로 승격한다.

## 대안

| 대안 | 판단 |
|---|---|
| Qwen3-ASR 0.6B fine-tuning | 더 작고 빠르지만 base CER가 1.7B보다 상대 18.38% 높아 fallback |
| Whisper Large V3 fine-tuning 유지 | missing final 0 장점이 있으나 base CER가 1.7B보다 높아 비교 후보로 유지 |
| ForcedAligner를 ASR 후보로 평가 | transcript가 필요한 정렬 모델이므로 기각 |
| Qwen 1.7B base를 영구 승격 | 전체 gate 전에는 기각하고 1-slot 운영 canary만 채택 |
| Qwen 1.7B full SFT 후 같은 vLLM/VAD gate 재평가 | 정확도와 학습·서빙 호환성을 함께 검증해 채택 |

## 영향과 검증

- STT Lab에 loopback Qwen streaming replay backend와 CLI 옵션을 추가했다.
- 제품의 LiveKit, Redis caption payload, Spring/FE API 계약은 바꾸지 않았다. 따라서
  `docs/CONTRACT.md`와 FE/BE 계약 테스트 변경은 불필요하다.
- 단위 테스트는 Qwen session protocol, PCM16→float32 변환, 누적 text delta, authoritative final,
  loopback URL 제한과 candidate parser를 검증한다.
- 재현 artifact:
  - `/home/liveclass/ai/experiments/qwen3-asr-benchmark/replay-dev-benchmark-502-qwen3-asr-0.6b-artifacts/`
  - `/home/liveclass/ai/experiments/qwen3-asr-benchmark/replay-dev-benchmark-502-qwen3-asr-1.7b-artifacts/`
  - `/home/liveclass/ai/experiments/qwen3-asr-benchmark/missing-final-qwen3-asr-1.7b-context-diagnostic.json`
  - `/home/liveclass/ai/training-data/qwen3-asr-1.7b-v1-seed37/provenance.json`
  - `/home/liveclass/ai/checkpoints/qwen3-asr-1.7b-smoke-seed37/`
- 실행 당시 report의 `codeSha`는 작업 branch의 부모 `adc5a24`이고 Qwen adapter 변경은
  이 ADR과 같은 commit에 포함된다. 재현 시에는 merge된 commit을 기준으로 사용한다.
