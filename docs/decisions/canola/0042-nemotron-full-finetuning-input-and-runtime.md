# ADR-0042: Nemotron은 `.nemo` 정본 tokenizer와 train/dev 파생 manifest로 full fine-tuning한다

- **상태**: 채택
- **일자**: 2026-08-03
- **관련**: [ADR-0037](0037-ai-roadmap-and-evaluation-gates.md),
  [ADR-0040](0040-stt-fine-tuning-dry-run-and-promotion.md),
  [ADR-0041](0041-aihub-dual-transcription-evaluation.md)

## 맥락

AI Hub 한국어 강의 train/dev는 LiveClass 공통 manifest인 `audioPath`, `durationMs`,
`trainingReference`를 사용한다. NVIDIA Nemotron 3.5 ASR의 공식 NeMo/Lhotse 학습 입력은
`audio_filepath`, 초 단위 `duration`, `text`, 언어 prompt metadata를 요구한다. 원본 JSONL을
직접 넘기거나 기존 Transformers inference adapter를 학습기로 간주할 수 없다.

다운로드한 checkpoint는 cache-aware FastConformer RNNT prompt 모델이다. checkpoint 내부 설정은
16 kHz, encoder 24 layers, 10 ms feature stride, subsampling 8, `ko-KR` prompt ID 14다. NVIDIA
[모델 카드](https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b)와
[fine-tuning 예제](https://github.com/nvidia-riva/tutorials/blob/main/asr-finetune-nemotron-3.5-asr-streaming-prompt.ipynb)는
`.nemo` 복원, Lhotse manifest와 prompt 언어 conditioning을 사용한다.

Hugging Face 변환본과 `.nemo`는 같은 모델 이름이지만 tokenizer 구현이 같다고 가정할 수 없다.
실측에서 HF tokenizer와 `.nemo` SentencePiece의 token ID는 준비된 32,227개 전사 중 26,253개에서
달랐다. 따라서 HF tokenizer로 OOV와 label 길이를 검사한 manifest는 NeMo 학습 정본이 아니다.

## 결정

### 1. `.nemo` checkpoint와 그 내부 SentencePiece를 함께 정본으로 고정한다

준비기는 `.nemo` tar에서 config와 SentencePiece model을 직접 읽고 다음 계약을 fail-closed한다.

| 항목 | 고정값 |
|---|---|
| model class | `EncDecRNNTBPEModelWithPrompt` |
| `.nemo` SHA-256 | `210214ed94039bf6bfbb9a047c7fa289628db75b103e2bf6381fa78285436a74` |
| NeMo checkpoint version | `2.8.0rc0` |
| sample rate | 16,000 Hz |
| encoder | 24 layers, subsampling 8, feature stride 0.01초 |
| Korean prompt | `ko-KR` → 14 |
| tokenizer | SentencePiece 13,087 tokens, unknown ID 0 |
| tokenizer SHA-256 | `ce3895e40806f02a26c3a225161b96ef682d6c0054bae32a245dec4258d7d291` |

HF processor 경로를 준비기 인자로 받지 않는다. decoder vocabulary도 바꾸지 않고 pretrained
tokenizer를 재사용한다.

### 2. 원본을 보존하고 train/dev 전용 NeMo manifest를 새로 만든다

학습 row는 다음 형식이다.

```json
{
  "id": "arch.C00000.U00000",
  "audio_filepath": "/absolute/path.wav",
  "duration": 4.27,
  "text": "철자 전사",
  "lang": "ko-KR",
  "target_lang": "ko-KR",
  "prompt_mode": "langID",
  "sampling_rate": 16000
}
```

- `text`는 ADR-0041의 `trainingReference`인 철자 전사를 사용한다.
- `target_lang=ko-KR`와 `prompt_mode=langID`를 모두 명시해 auto/unified 무작위 prompt를 쓰지 않는다.
- WAV는 mono PCM16 16 kHz를 다시 검사한다.
- checkpoint 기본 학습 경계에 맞춰 20초를 넘는 clip은 첫 baseline에서 제외한다.
- `.nemo` tokenizer unknown token이 있거나 token 수가 근사 encoder frame 수보다 많은 비정상 pair는
  제외한다. 원문을 추측해서 고치지 않는다.
- 준비기는 train/dev 인자만 제공하며 기존 split guard가 test/golden 또는 누수를 거부한다.
- 출력 디렉터리가 이미 있으면 덮어쓰지 않는다. source manifest, model, tokenizer hash와 제외 이유를
  `preparation-report.json`, `excluded.jsonl`에 남긴다.

실제 선택 결과는 다음과 같다.

| split | 원본 | 선택 | 시간 | 20초 초과 | tokenizer unknown | token/frame 이상 |
|---|---:|---:|---:|---:|---:|---:|
| train | 31,296 | 28,241 | 58.2693시간 | 2,092 | 956 | 7 |
| dev | 4,444 | 3,988 | 7.8344시간 | 280 | 174 | 2 |

train/dev의 화자·강의·clip 교집합은 기존 `TrainingDatasetPair` 검증에서 0이다. test, golden,
`dev-benchmark-502.jsonl`은 준비·profile·학습에 사용하지 않는다.

### 3. 공식 NeMo full-parameter 경로를 사용한다

Transformers용 임의 training loop를 만들지 않는다. 고정 NeMo source의
`examples/asr/speech_to_text_finetune.py`가 `.nemo`를 복원하고 Prompt RNNT 전 파라미터를 업데이트한다.
실제 smoke에서 637M trainable, non-trainable 0을 확인했다.

기본 학습 설정은 다음과 같다.

| 항목 | 값 |
|---|---|
| GPU | `CUDA_VISIBLE_DEVICES=1`, H200 NVL 1장 |
| precision | BF16 mixed |
| optimizer | AdamW, LR `1e-4`, betas `(0.9, 0.98)`, weight decay `1e-3` |
| scheduler | cosine, warmup 100 steps, min LR `1e-6` |
| augmentation | checkpoint 계열 SpecAugment |
| dynamic batch | 200초, quadratic duration 15, 30 buckets |
| budget | 6,000 steps, 2,000 steps마다 전체 dev |
| checkpoint selection | `val_wer`, top 3 + `.nemo` |

metadata-only Lhotse sampler에서 train 1회는 1,948 batches, 평균 batch audio 107.68초다. 6,000
steps는 약 3.08회다. 20-step H200 profile의 첫 compile 이후 step timing은 평균 약 0.25초였다.
전체 dev 검증과 checkpoint 저장을 포함한 첫 baseline은 약 35~50분으로 예상했다.

Lightning의 정수 `val_check_interval`은 `check_val_every_n_epoch: 1`과 함께 쓰면 epoch 안의 batch
간격으로 제한된다. 실제 첫 실행에서 1 epoch가 1,948 batches라 2,000-step 검증과 checkpoint가
발생하지 않는 것을 확인하고 해당 실행을 중단했다. NeMo의 step-based 공식 설정과 같이
`check_val_every_n_epoch: null`을 고정해 global step 2,000/4,000/6,000에서 검증한다.

### 3-1. 2026-08-03 baseline 실행 결과

교정한 설정으로 H200 NVL GPU 1에서 실행한 `runs-spm-v2`는 exit 0으로 끝났다. 총 wall time은
29분 24초, 학습 프로세스 최대 host RSS는 약 11.5 GB, 학습 중 GPU 메모리는 약 32 GB였다.
각 검증은 선택된 dev 3,988 clips 전체를 499 batches로 계산했다.

| global step | dev WER | 직전 검증 대비 |
|---:|---:|---:|
| 2,000 | 0.37213 | 기준 |
| 4,000 | 0.36103 | -0.01110 |
| 6,000 | **0.35542** | -0.00561 |

2,000 대비 6,000의 절대 개선은 0.01671, 상대 개선은 약 4.5%다. 6,000 step까지 dev가 계속
개선됐으므로 이 실행에서는 마지막 checkpoint를 선택한다. 이 표는 checkpoint 선택용 dev WER이며
서비스 정규화 CER, 반복 생성, latency 또는 test 성능을 대신하지 않는다.

실행 root는 다음과 같다.

```text
/home/liveclass/ai/training/nemotron-3.5-full-20260803/runs-spm-v2/LiveClass-Nemotron-3.5-ASR-Full-Finetune/2026-08-03_18-13-18
```

| artifact | 크기 | SHA-256 |
|---|---:|---|
| `checkpoints/LiveClass-Nemotron-3.5-ASR-Full-Finetune--val_wer=0.3554-epoch=3.ckpt` | 7,660,815,517 bytes | `f689b4e414d1f87c562df1c89e93225b94e0e3200ba865b674d06191680ff5f1` |
| `checkpoints/LiveClass-Nemotron-3.5-ASR-Full-Finetune.nemo` | 2,553,098,240 bytes | `4cf5368cbb9d57a48ee0b5afbb3790deedd4612963a095b2db30d3f7f57c79fa` |

최종 `.nemo` archive에서 `model_config.yaml`, `model_weights.ckpt`, 원 checkpoint와 같은
SentencePiece model과 vocabulary를 다시 확인했다. CPU `restore_from`도 exit 0으로 끝났고
`EncDecRNNTBPEModelWithPrompt`, 637,997,088 parameters, vocabulary 13,087로 복원됐다. 학습 종료 후
GPU 메모리도 반환됐다.

### 4. 학습 runtime을 운영 venv와 분리하고 NeMo lock 조합을 따른다

전용 runtime은 PyTorch `2.11.0+cu128`, NeMo source commit
`fc6a475f3d8b8fc0c8743d3107c5e933ecd5b99d`, numba `0.65.0`, llvmlite `0.47.0`,
numba-cuda `0.30.0`으로 고정한다. numba `0.66.0`만 설치한 조합은 RNNT CUDA loss compile에서
`Signature mismatch`로 실패했고, NeMo lock 조합은 forward, RNNT loss, backward와 optimizer step을
통과했다.

Lhotse `concurrent_bucketing`은 끈다. 짧은 fixed-step smoke에서 background bucket thread가 Python
shutdown을 기다리게 한 실측이 있었고, 비동기 prefetch 이득보다 정상 종료와 checkpoint 확정성을
우선한다. 일반 DataLoader worker는 유지한다.

### 5. 학습과 모델 승격을 분리한다

학습 중 checkpoint 선택은 dev WER만 사용한다. 학습 완료가 배포 완료를 뜻하지 않는다. checkpoint를
고정한 뒤 ADR-0039/0040의 동일 VAD dev 평가에서 CER, missing final, 반복, hallucination과 latency를
base Nemotron과 비교한다. test는 설정을 모두 고정한 뒤 최종 1회만 허용한다.

## 대안

| 대안 | 판단 |
|---|---|
| 원본 LiveClass JSONL을 NeMo에 직접 입력 | 필드와 prompt 계약이 달라 기각 |
| HF tokenizer로 OOV/길이 검사 | 실제 `.nemo` token ID와 다름을 실측해 기각 |
| 새 Korean tokenizer로 decoder vocabulary 변경 | domain baseline에서 decoder 재초기화 위험이 커 기각 |
| VAD로 원본 utterance를 잘라 전체 transcript 부착 | 정렬되지 않은 label이라 ADR-0040에 따라 기각 |
| NeMo `.nemo` tokenizer + train/dev 파생 manifest + full parameter | 모델 고유 계약과 평가 격리를 함께 만족해 채택 |

## 영향과 검증

- 변경 범위는 `ai/stt-lab` 학습 준비/설정과 이 ADR이다. Spring, FE, Redis/API payload는 바뀌지
  않으므로 `docs/CONTRACT.md`와 공유 계약 테스트 변경은 불필요하다.
- 기존 test, golden, benchmark 코드·manifest·artifact는 수정하지 않는다.
- 검증은 model/tokenizer contract, 파생 manifest 감사, NeMo dev batch, 2 train steps, RNNT loss,
  backward, optimizer step, 프로세스 정상 종료, 1-step validation/checkpoint 저장 순서로 수행한다.
- 본 학습은 exit 0, 6,000-step dev WER 0.35542와 위 artifact hash로 완료했다. 모델 승격 여부는
  기존 고정 dev 평가를 별도로 수행한 뒤 결정한다.
