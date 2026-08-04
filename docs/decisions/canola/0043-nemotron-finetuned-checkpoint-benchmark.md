# ADR-0043: fine-tuned Nemotron은 고정 운영 VAD dev gate에서 개선됐지만 운영 승격은 보류한다

- **상태**: 채택
- **일자**: 2026-08-04
- **관련**: [ADR-0037](0037-ai-roadmap-and-evaluation-gates.md),
  [ADR-0039](0039-production-vad-stt-experiment-runner.md),
  [ADR-0040](0040-stt-fine-tuning-dry-run-and-promotion.md),
  [ADR-0041](0041-aihub-dual-transcription-evaluation.md),
  [ADR-0042](0042-nemotron-full-finetuning-input-and-runtime.md)

## 맥락

ADR-0042의 6,000-step full fine-tuning 결과는 `.nemo` archive다. 기존 제품 Nemotron replay
backend는 Hugging Face Transformers directory를 읽는 incremental adapter이므로 `.nemo`를 같은
경로에 넣을 수 없다. tuned checkpoint만 다른 decoder로 평가하고 ADR-0041의 HF incremental base와
직접 비교하면 fine-tuning 효과와 runtime 차이를 분리할 수 없다.

학습에 사용한 일반 dev 3,988 clips의 `val_wer=0.35542`는 checkpoint 선택 지표다. 서비스의 VAD,
다중 정답 CER, 빈 final, 반복 생성과 Whisper 기준선을 대신하지 않는다. 따라서 학습에 사용하지 않은
고정 `dev-benchmark-502.jsonl`을 다시 사용해야 한다. test와 golden은 설정 확정 전까지 열지 않는다.

## 결정

### 1. `.nemo` 전용 final-only 품질 gate를 둔다

`ai/stt-lab` replay에 `nemotron-nemo` backend를 추가한다.

- `ASRModel.restore_from()`으로 Prompt-RNNT `.nemo`를 복원한다.
- `ko-KR` prompt ID 14를 고정하고 출력 언어 tag를 제거한다.
- base와 tuned 모두 FP32, batch 1, 같은 NeMo source/runtime으로 실행한다.
- 제품 `VadSegmenter`가 확정한 동일 segment를 소비하고 authoritative final만 만든다.
- 한 candidate가 끝나면 model을 해제한 뒤 다음 candidate를 적재한다.
- 이 경로는 checkpoint 정확도 비교용이다. native cache-aware streaming이나 제품 adapter의 운영
  지연·동시성을 증명하지 않는다.

Whisper는 ADR-0041과 같이 local Large V3 Transformers BF16 final-only decoder를 사용한다. 세 후보는
한 프로세스에서 순차 실행해 clip 순서와 segment plan hash가 다르면 실패시킨다.

### 2. 기존 고정 dev benchmark를 GPU 1에서 실행한다

| 항목 | 고정값 |
|---|---|
| manifest | `dev-benchmark-502.jsonl`, 502 clips, 8 speakers, 9 lectures |
| manifest SHA-256 | `51d91b3d6316b762e5df6ed3c235cb94e462cfa0465d8dc95131f18227839f44` |
| 전체 음성 | 4,435,071 ms |
| 제품 VAD | 16 kHz, 20 ms frame, min 300 ms, silence 500 ms, max 8,000 ms, pad 200 ms |
| 공통 segment | 904 |
| mode/workers | `accuracy` / `1` |
| GPU | 물리 GPU 1만 노출, H200 NVL |
| base `.nemo` SHA-256 | `210214ed94039bf6bfbb9a047c7fa289628db75b103e2bf6381fa78285436a74` |
| tuned `.nemo` SHA-256 | `4cf5368cbb9d57a48ee0b5afbb3790deedd4612963a095b2db30d3f7f57c79fa` |

`CUDA_VISIBLE_DEVICES=1`은 Python 프로세스 시작 전에 주입하고 CLI에도
`--cuda-visible-devices 1`을 명시했다. 실행 중 PID가 물리 GPU 1에만 잡힌 것을 `nvidia-smi`로
확인했다. GPU 0의 기존 VLLM/BGE는 유지했다. 세 candidate의 clip ID와 clip별 segment plan hash는
모두 같았다.

### 3. 결과와 승격 판단

| candidate | decoder | multi-ref CER | literal CER | mean RTF | missing final | peak CUDA reserved |
|---|---|---:|---:|---:|---:|---:|
| Nemotron base `.nemo` | NeMo FP32 final-only | 20.0452% | 24.2116% | 0.00868 | 74 | 2.699 GiB |
| Nemotron tuned `.nemo` | NeMo FP32 final-only | **16.7335%** | **20.3141%** | **0.00827** | **39** | 2.799 GiB |
| Whisper Large V3 | Transformers BF16 final-only | **16.1229%** | **20.2376%** | 0.04623 | **0** | 3.629 GiB |

- tuned Nemotron은 base 대비 multi-ref CER가 3.3116%p, 상대 **16.52%** 개선됐다.
- literal CER도 3.8976%p, 상대 **16.10%** 개선됐다.
- missing final은 74개에서 39개로 **47.30%** 줄었고, 완전히 빈 clip은 13개에서 1개로 줄었다.
- tuned Nemotron의 mean RTF는 Whisper보다 약 **5.59배 빠르다**. 이 값은 paced/native streaming
  latency가 아닌 대기 없는 single-worker segment inference 처리량이다.
- tuned Nemotron은 Whisper보다 multi-ref CER가 0.6107%p, 상대 3.79% 높다. literal CER 차이는
  0.0765%p로 작지만 Whisper는 missing final이 0이다.

따라서 full fine-tuning의 효과는 채택한다. 그러나 tuned checkpoint의 즉시 운영 승격은 보류한다.
정확도 선두와 빈 final 무결성 gate는 여전히 Whisper가 앞선다. Nemotron의 속도 이점만으로 빈 자막을
허용하지 않는다.

## 관찰된 사례

- `arch.C06771.U00000`: base는 빈 출력, tuned는 `아까부터 그랬어요.`로 정답을 복구했다.
- `comp.C02743.U00219`: base는 빈 출력, tuned는 `이거 안 쓰면요`로 정답을 복구했다.
- `arch.C04157.U00127`: base CER 13.64%에서 tuned CER 68.18%로 회귀했다. tuned가
  `pointer`, `memory` 영문 표기를 출력했지만 이 sample 정답은 한글 표기만 가진다. 영문 출력 자체를
  오류로 단정하지 않고 annotation/용어 정답 정책과 함께 분석한다.
- 이전 Whisper LoRA에서 반복 생성이 발생했던 `arch.C04157.U00236`은 tuned Nemotron에서 반복하지
  않았고 CER 32.84%, missing segment 0이었다. 다만 이 한 건으로 반복 방지 gate가 충족되지는 않는다.

## 후속 gate

1. tuned Nemotron의 39개 empty final을 음성 길이, VAD boundary reason, SNR, decoder EOS 기준으로
   분류하고 빈 결과 fallback 또는 decoder 설정을 실험한다.
2. 영문 기술용어 출력 회귀를 annotation 오류와 실제 표기 정책으로 나눠 학습 target/평가 alternative를
   재검토한다. 평가 정답을 모델 결과에 맞춰 사후 변경하지 않는다.
3. `.nemo` native cache-aware streaming adapter에서 ADR-0039의 paced 지연, 누락, 반복, 30분 연속
   replay를 별도로 통과시킨다.
4. 위 dev 설정을 고정한 뒤에만 speaker-disjoint test를 후보당 최종 1회 실행한다.

## 대안

| 대안 | 판단 |
|---|---|
| tuned `.nemo`를 기존 HF directory backend에 전달 | artifact 형식과 tokenizer/runtime이 달라 기각 |
| tuned NeMo 결과를 ADR-0041의 HF incremental base와 바로 비교 | runtime 차이와 학습 효과가 섞여 기각 |
| whole utterance NeMo WER만으로 승격 | 제품 VAD·다중 정답·빈 final을 검증하지 못해 기각 |
| base/tuned 동일 NeMo final-only gate + Whisper 동일 VAD 비교 | 학습 효과와 현재 정확도 선두를 함께 확인해 채택 |

## 증거와 영향

- 정본 result:
  `/home/liveclass/ai/experiments/stt-20260804-nemotron-full/replay-dev-benchmark-502-c1.json`
  - SHA-256: `623040d2b266966bf8219fd6f09695f939e93830db5057d36df3bcff2fc7ff37`
- 분리 artifact:
  `/home/liveclass/ai/experiments/stt-20260804-nemotron-full/replay-dev-benchmark-502-c1-artifacts/`
  - `run.json`: `d332a322a030de8cea84e77d67071976b29054716bff82efe50fa8fdfaa216bf`
  - `samples.jsonl`: `f7553229315a4d855b1b499978e60944a4ab0f85e9992b83d79a8e92bc3bcdf8`
- result의 `codeSha`는 실행 당시 HEAD `f80fbb0eb9c970dc184dc11845a1ae4153353fbc`다. 다만
  `nemotron-nemo` backend는 이 실행 시점에 아직 미커밋 worktree 변경이었다. 이 dev artifact는 이번
  승격 보류 판단의 증거로 사용하되, release 승격 증거로 재사용하지 않는다. 최종 commit을 만든 뒤
  test를 열기 전 같은 dev gate를 한 번 재현해 commit SHA와 결과를 결속한다.
- code gate: STT Lab `47 passed`, Ruff `All checks passed`.
- 변경 범위는 `ai/stt-lab`과 이 ADR이다. Spring/FE/Redis/API payload를 바꾸지 않으므로
  `docs/CONTRACT.md`와 FE/BE 계약 테스트 변경은 불필요하다.
