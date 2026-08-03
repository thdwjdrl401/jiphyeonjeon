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

- train/dev는 기존 speaker·lecture disjoint split을 그대로 사용한다.
- 정렬된 label이 없으므로 운영 VAD segment에 전체 문장 label을 붙여 학습하지 않는다.
- test와 golden은 학습·튜닝에 사용하지 않는다.
- 첫 pilot은 BF16 full SFT로 고정하고 LoRA와 hyperparameter sweep을 동시에 진행하지 않는다.
- checkpoint는 processor/tokenizer/config/weight를 함께 저장해 standalone load가 가능해야 한다.

최신 vLLM의 offline Qwen3-ASR 경로는 LoRA를 지원하지만 realtime architecture의 LoRA 지원은
공식 표에서 확인되지 않았다. 따라서 첫 realtime 승격 경로는 full checkpoint다. 이후 LoRA를
실험하면 serving 전에 standalone full checkpoint로 merge하고 동일 replay를 다시 통과해야 한다.

### 3. serving은 공식 Qwen vLLM backend를 별도 model owner로 둔다

Qwen3-ASR streaming은 공식 `qwen-asr` package의 vLLM backend로 검증한다. realtime-agent와
모델 process를 분리하고 GPU 0, loopback bind, 명시적 model path를 강제한다.

현재 사용한 `qwen-asr-demo-streaming`은 Flask development server이므로 운영 runtime으로
승격하지 않는다. 후속 구현은 같은 `Qwen3ASRModel.LLM` engine을 production HTTP server와
supervisor, `/healthz`, `/readyz`, request timeout, bounded session 수로 감싼다. 1.7B
fine-tuned checkpoint가 그 runtime에서 load되고 동일 502 replay를 통과해야 provider 교체가 가능하다.

### 4. fine-tuned checkpoint 승격 gate를 고정한다

- 고정 dev multi-ref CER: base 14.6870% 대비 상대 10% 이상 개선, 즉 **13.2183% 이하**
- 일반 한국어 holdout: base 대비 절대 2%p 초과 악화 금지
- missing final, warning, timeout, frame/segment drop: 모두 0
- paced concurrency 1/4/12: OOM 0, backlog·p95 latency 예산 통과
- 설정 고정 후 test split 최종 1회
- LiveKit audio → Qwen runtime → Redis caption canary 통과

## 대안

| 대안 | 판단 |
|---|---|
| Qwen3-ASR 0.6B fine-tuning | 더 작고 빠르지만 base CER가 1.7B보다 상대 18.38% 높아 fallback |
| Whisper Large V3 fine-tuning 유지 | missing final 0 장점이 있으나 base CER가 1.7B보다 높아 비교 후보로 유지 |
| ForcedAligner를 ASR 후보로 평가 | transcript가 필요한 정렬 모델이므로 기각 |
| Qwen 1.7B를 base 결과만으로 즉시 운영 전환 | missing final과 운영 부하 gate 미통과로 기각 |
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
- 실행 당시 report의 `codeSha`는 작업 branch의 부모 `adc5a24`이고 Qwen adapter 변경은
  이 ADR과 같은 commit에 포함된다. 재현 시에는 merge된 commit을 기준으로 사용한다.
