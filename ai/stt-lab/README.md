# STT Lab

한국어 강의 STT 후보를 같은 입력·지표로 비교하는 opt-in GPU 평가 하네스다. 제품
`realtime-agent`와 분리해 운영 중인 LiveKit worker를 재시작하지 않고 실행한다.

## 평가 원칙

- 2~3분 대표 음성 한 개는 빠른 `golden` 회귀 확인에만 사용한다.
- 모델 선택은 speaker-disjoint holdout(최소 100 clip·60분·8명)으로 결정한다.
- golden/test 음성과 정답은 학습 데이터에 넣지 않는다.
- 음성 원본·결과·checkpoint는 Git에 넣지 않는다(`data/`, `results/`, `checkpoints/`).
- 한 benchmark 프로세스에는 물리 GPU 하나만 보이게 한다. 여러 GPU가 있는 서버에서는
  `CUDA_VISIBLE_DEVICES`를 Python 시작 전에 지정하고 CLI의 `--cuda-visible-devices`와 같은 값으로
  고정한다.

입력은 압축하지 않은 mono PCM16 WAV, 16 kHz여야 한다. manifest는 UTF-8 JSONL이며
필수 필드는 `id`, `audioPath`, `reference`, `language`, `speakerId`, `split`, `consent`다.
AI Hub 변환 manifest는 원본 이중 전사를 `reference`에 보존하고 철자 전사를
`trainingReference`에 저장한다. `terms`와 파일 무결성 검증용 `sha256`은 선택 필드다.

```json
{"id":"golden-ko-tech-001","audioPath":"../data/golden-ko-tech-001.wav","reference":"정답 원문","language":"ko-KR","speakerId":"speaker-001","split":"golden","terms":["LiveKit","WebRTC"],"consent":"internal-evaluation"}
```

## AI Hub 데이터 준비

원본은 Git 밖 `/home/liveclass/ai/datasets/aihub-korean-lecture/v1`에 둔다. 브라우저에서
올린 ZIP은 업로드가 완료되고 `bsdtar -tf` 무결성 검사가 통과한 뒤에만 압축을 푼다.
스크립트는 원본 ZIP을 수정하지 않고 `extracted/` 아래에 archive별 디렉터리를 만든다.

```bash
cd ai/stt-lab
uv sync --frozen
./scripts/extract_aihub_archives.sh \
  /home/liveclass/ai/datasets/aihub-korean-lecture/v1
uv run --frozen stt-lab-aihub \
  --json-root /home/liveclass/ai/datasets/aihub-korean-lecture/v1/extracted/annotations \
  --wav-root /home/liveclass/ai/datasets/aihub-korean-lecture/v1/extracted/audio \
  --output-root /home/liveclass/ai/datasets/aihub-korean-lecture/v1 \
  --strict
```

압축 해제 스크립트가 `ZIP decompression failed`로 종료되면 아직 업로드 중이므로 기다린다.
분할 도구는 JSON↔WAV 불일치, 손상된 annotation/WAV, 16 kHz·mono·PCM16이 아닌 음성,
test 최소 기준을 audit하고 `--strict`에서 실패로 처리한다. `--hash-audio`는 WAV 전체
SHA-256이 필요할 때만 사용한다.

split은 화자와 강의를 연결한 component 단위로 수행한다. 한 화자가 여러 강의를 맡거나
한 강의에 여러 화자가 있어도 연결된 sample 전체가 같은 split에 들어가므로 speaker와
lecture 교집합이 모두 0으로 유지된다. 결과는 다음 위치에 생성된다.

- `manifests/source-index.jsonl`: 원본 JSON·WAV·화자·강의 연결
- `manifests/train.jsonl`, `dev.jsonl`, `test.jsonl`, `golden.jsonl`
- `reports/audit.json`, `split-summary.json`

## 준비와 실행

```bash
cd ai/stt-lab
uv sync --frozen
uv run --frozen stt-lab \
  --manifest manifests/golden.jsonl \
  --validate-only
```

서비스와 같은 Nemotron adapter를 평가한다.

```bash
uv run --frozen stt-lab \
  --manifest manifests/golden.jsonl \
  --backend nemotron \
  --model /home/liveclass/ai/models/nemotron-3.5-asr-streaming-0.6b \
  --cuda-visible-devices 0 \
  --output results/nemotron-golden.json
```

공개 Whisper checkpoint를 평가한다. 이 경로는 native streaming이 아니므로
`firstDeltaMs`는 최종 결과 완료 시간과 같다.

```bash
uv run --frozen stt-lab \
  --manifest manifests/golden.jsonl \
  --backend whisper \
  --model /home/liveclass/ai/models/whisper-large-v3 \
  --precision bfloat16 \
  --cuda-visible-devices 0 \
  --output results/whisper-large-v3-golden.json
```

결과 JSON은 clip별 원문·가설·CER·용어/숫자 정확도·지연·RTF와 평가 프로세스의
peak CUDA memory를 보존한다. AI Hub `(철자 전사)/(발음 전사)`는 위치별 두 표기와
그 혼합 출력을 모두 정답으로 인정한다. `normalizedCer`는 이 다중 정답 기준이고,
`literalNormalizedCer`는 원본 괄호 표기를 문자 그대로 비교한 감사용 지표다. GPU 전체
사용량과 12-stream 동시성은 후속 replay benchmark에서 별도로 측정한다.

## 운영 VAD 기반 통합 replay

모델 선택에는 whole-WAV 명령 대신 제품 `realtime-agent`의 20 ms 입력·`VadSegmenter`·
`SegmentedStreamingEngine`을 그대로 통과하는 통합 replay를 사용한다. 각 후보가 만든
segment plan hash가 다르면 실행이 실패하므로 Nemotron과 Whisper가 동일한 음성 경계를
소비했는지 결과에서 검증할 수 있다.

먼저 대기 없이 dev 정확도를 비교한다.

```bash
uv run --frozen stt-lab-replay \
  --manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/dev.jsonl \
  --candidate nemotron-base=nemotron@/home/liveclass/ai/models/nemotron-3.5-asr-streaming-0.6b \
  --candidate whisper-base=whisper@/home/liveclass/ai/models/whisper-large-v3 \
  --mode accuracy \
  --workers 1 \
  --output results/replay-dev-c1.json
```

실시간 지연은 같은 manifest를 실제 audio clock에 맞춰 공급한다. `--workers`는 독립 stream과
동일한 수의 model slot을 만든다. 현재 in-process topology의 1/4/12 동시성 비교에 사용하되,
GPU 메모리를 확인하며 한 단계씩 올린다.

```bash
uv run --frozen stt-lab-replay \
  --manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/dev.jsonl \
  --candidate nemotron-base=nemotron@/home/liveclass/ai/models/nemotron-3.5-asr-streaming-0.6b \
  --mode paced \
  --workers 1 \
  --output results/replay-paced-dev-c1.json
```

결과에는 candidate capability(`INCREMENTAL` 또는 `SEGMENT_FINAL_ONLY`), 공통 VAD segment
plan과 hash, authoritative final 기반 CER, segment별 VAD-ready→first/final 지연, paced
speech-start/end 지연, RTF와 peak CUDA memory가 기록된다. `test` split은 설정을 모두 고정한
뒤 `--allow-test`를 명시해야만 실행된다.

`--output results/replay-dev-c1.json`을 지정하면 monolithic 정본과 함께 기본적으로
`results/replay-dev-c1-artifacts/`에 `run.json`, `segment-plan.jsonl`, `samples.jsonl`,
`summary.json`, `comparison.csv`, `report.md`를 생성한다. 경로를 고정하려면
`--artifact-dir`을 사용한다. 기존 artifact 디렉터리는 덮어쓰지 않는다.


### fine-tuned `.nemo` checkpoint 품질 gate

학습 결과인 `.nemo`는 Transformers 기반 `nemotron` backend에 넘기지 않는다. base와 tuned
checkpoint를 같은 NeMo Prompt-RNNT offline decoder로 비교할 때만 `nemotron-nemo`를 사용한다.
이 backend는 운영 VAD가 닫은 segment를 `ko-KR`, FP32로 전사하는 final-only 품질 gate다. native
cache-aware streaming 지연이나 배포 adapter 동작을 증명하지 않는다.

일반 STT Lab venv에 NeMo를 섞지 않고 ADR-0047의 고정 학습 runtime을 사용한다. 해당 runtime에는
운영 VAD lock과 같은 `webrtcvad-wheels==2.0.14`가 필요하다. GPU 번호는 인자만 나중에 넘기지 말고
아래처럼 프로세스 환경에도 먼저 주입한다.

```bash
NEMO_TRAIN_ROOT=/home/liveclass/ai/training/nemotron-3.5-full-20260803

CUDA_VISIBLE_DEVICES=1 \
PYTHONPATH=/home/liveclass/liveclass/ai/stt-lab/src:/home/liveclass/liveclass/ai/realtime-agent \
"$NEMO_TRAIN_ROOT/.venv/bin/python" -m stt_lab.replay_cli \
  --manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/dev-benchmark-502.jsonl \
  --candidate nemotron-base-nemo=nemotron-nemo@/home/liveclass/ai/models/nemotron-3.5-asr-streaming-0.6b/nemotron-3.5-asr-streaming-0.6b.nemo \
  --candidate nemotron-tuned-nemo=nemotron-nemo@"$NEMO_TRAIN_ROOT/runs-spm-v2/LiveClass-Nemotron-3.5-ASR-Full-Finetune/2026-08-03_18-13-18/checkpoints/LiveClass-Nemotron-3.5-ASR-Full-Finetune.nemo" \
  --candidate whisper-large-v3=whisper@/home/liveclass/ai/models/whisper-large-v3 \
  --mode accuracy \
  --workers 1 \
  --precision bfloat16 \
  --cuda-visible-devices 1 \
  --output /home/liveclass/ai/experiments/stt-20260804-nemotron-full/replay-dev-benchmark-502-c1.json
```

2026-08-04 고정 dev 502 clips/904 segments 결과에서 tuned Nemotron은 base 대비 multi-reference
CER를 20.05%에서 16.73%로 낮췄다. Whisper Large V3는 16.12%였고, empty final segment는
base/tuned/Whisper가 각각 74/39/0이었다. 따라서 학습 효과는 확인했지만 운영 승격은 보류한다.
전체 판단과 artifact hash는 [ADR-0048](../../docs/decisions/canola/0048-nemotron-finetuned-checkpoint-benchmark.md)에
고정한다.

## 학습 사전검증

AI Hub manifest 생성 시 학습 누수 검사용 `lectureId`, `category`, `durationMs`도 함께 보존한다.
실제 학습 전에 train/dev manifest만 허용되는지, 화자·강의 교집합이 0인지, 음성과 metadata가
완전한지 먼저 검사한다. `test` 또는 `golden` sample이 섞이면 실패한다.

```bash
uv run --frozen stt-lab-training \
  --train-manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/train.jsonl \
  --dev-manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/dev.jsonl \
  --output results/training-preflight.json
```

학습 batch는 원본 utterance WAV와 철자 전사 `trainingReference`를 사용한다. 예를 들어
`(software)/(소프트웨어)`를 괄호 표기 그대로 학습시키지 않고 `software`를 target으로 삼는다.
정렬된 sub-segment label 없이 운영 VAD로 WAV를 잘라 전체 transcript를 붙이지 않는다. checkpoint artifact에는
manifest hash·seed·학습 설정·loss만 기록하고 원본 음성·transcript·secret은 복사하지 않는다.


Whisper 학습 pipeline 자체는 아래 opt-in dry-run으로 검증한다. 이 명령은 train batch 2개,
dev batch 1개를 사용해 optimizer step→save→새 Python process에서 optimizer/model reload와 다음
step→저장 checkpoint의 운영 VAD golden replay까지 모두 성공해야 종료한다. 실행 전에 GPU 0의
운영 realtime-agent/BGE 점유와 여유 메모리를 확인한다.

```bash
uv run --frozen stt-lab-whisper-dry-run run \
  --train-manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/train.jsonl \
  --dev-manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/dev.jsonl \
  --golden-manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/golden.jsonl \
  --model /home/liveclass/ai/models/whisper-large-v3 \
  --artifact-root /home/liveclass/ai/checkpoints \
  --run-id whisper-large-v3-dry-run-001 \
  --batch-size 2 \
  --cuda-visible-devices 0
```

이 실행은 품질 향상 증거가 아니라 pipeline 실행 가능성만 증명한다.

### Nemotron 3.5 ASR full fine-tuning

Nemotron은 Hugging Face 변환본의 tokenizer가 아니라 학습할 `.nemo` 안의 SentencePiece를 정본으로
사용한다. 준비 명령은 checkpoint의 모델 클래스, 16 kHz, encoder 24 layers, subsampling 8,
10 ms feature stride, `ko-KR` prompt ID 14와 tokenizer hash를 먼저 검사한다. 원본 manifest와 WAV는
수정하지 않고 새 출력 디렉터리에 NeMo/Lhotse JSONL만 만든다.

```bash
uv run --frozen stt-lab-nemotron-prepare \
  --train-manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/train.jsonl \
  --dev-manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/dev.jsonl \
  --nemo-model /home/liveclass/ai/models/nemotron-3.5-asr-streaming-0.6b/nemotron-3.5-asr-streaming-0.6b.nemo \
  --output-dir /home/liveclass/ai/training/nemotron-3.5-full-20260803/manifests-nemo-spm-v1
```

출력 row는 다음 필드만 학습에 사용한다.

```json
{"id":"arch.C00000.U00000","audio_filepath":"/absolute/path.wav","duration":4.27,"text":"철자 전사","lang":"ko-KR","target_lang":"ko-KR","prompt_mode":"langID","sampling_rate":16000}
```

- 20초를 넘는 clip, `.nemo` tokenizer의 unknown token이 있는 전사, token 수가 근사 encoder frame
  수를 넘는 비정상 pair는 제외 이유만 `excluded.jsonl`에 남긴다.
- `test`와 `golden` 인자는 존재하지 않는다. 잘못된 split을 train/dev 인자에 넣어도 기존 split guard가
  실패시킨다.
- `preparation-report.json`에는 source manifest, `.nemo`, tokenizer SHA-256과 선택/제외 개수를 남긴다.
- `trainingReference`의 철자 전사를 target으로 사용하고 원본 괄호 이중 전사는 학습하지 않는다.

학습 runtime은 운영 venv와 분리한다. 현재 검증 조합은 NeMo commit
`fc6a475f3d8b8fc0c8743d3107c5e933ecd5b99d`, PyTorch `2.11.0+cu128`, NeMo
`3.1.0+fc6a475f3`, numba `0.65.0`, llvmlite `0.47.0`, numba-cuda `0.30.0`이다.
NeMo 자체 lock과 다른 numba 조합은 RNNT loss compile 오류를 낼 수 있다.

```bash
TRAIN_ROOT=/home/liveclass/ai/training/nemotron-3.5-full-20260803

uv venv --python /opt/tljh/user/bin/python3 "$TRAIN_ROOT/.venv"
uv pip install --python "$TRAIN_ROOT/.venv/bin/python" \
  --index https://download.pytorch.org/whl/cu128 torch==2.11.0
uv pip install --python "$TRAIN_ROOT/.venv/bin/python" \
  "$TRAIN_ROOT/vendor/NeMo[asr]" \
  numba==0.65.0 llvmlite==0.47.0 'numba-cuda[cu12]==0.30.0'
```

본 학습은 `config/nemotron_full_finetune.yaml`을 사용한다. 기본값은 full parameter 637M, BF16,
AdamW, learning rate `1e-4`, 200초 dynamic batch, 6,000 step, 2,000 step마다 dev 검증이다.
현재 파생 train은 Lhotse sampler 기준 1회에 약 1,948 batch이므로 약 3.08회 순회한다.
background bucketing은 짧은 fixed-step run 종료 시 thread가 남는 것을 막기 위해 끈다.
global-step 간격을 epoch 길이와 독립시키기 위해 `check_val_every_n_epoch: null`을 함께 고정한다.

```bash
CUDA_VISIBLE_DEVICES=1 "$TRAIN_ROOT/.venv/bin/python" \
  "$TRAIN_ROOT/vendor/NeMo/examples/asr/speech_to_text_finetune.py" \
  --config-path="$PWD/config" \
  --config-name=nemotron_full_finetune \
  init_from_nemo_model=/home/liveclass/ai/models/nemotron-3.5-asr-streaming-0.6b/nemotron-3.5-asr-streaming-0.6b.nemo \
  model.train_ds.manifest_filepath="$TRAIN_ROOT/manifests-nemo-spm-v1/train.nemo.jsonl" \
  model.validation_ds.manifest_filepath="$TRAIN_ROOT/manifests-nemo-spm-v1/dev.nemo.jsonl" \
  exp_manager.exp_dir="$TRAIN_ROOT/runs-spm-v1"
```

2-step smoke에서 dev batch, `ko-KR` prompt, RNNT loss, backward, optimizer step과 정상 종료를 먼저
확인한다. 이어 1-step train/validation smoke로 `val_wer`, `.ckpt`, `.nemo` 저장까지 확인한 뒤 full
run을 시작한다. full checkpoint를 고르는 평가는 dev만 사용하고, 설정을 모두 고정하기 전에는 기존
test/golden/benchmark를 실행하거나 수정하지 않는다.

2026-08-03 H200 NVL 1장 실측에서 6,000 steps는 checkpoint 저장을 포함해 29분 24초 걸렸다.
전체 dev WER는 2,000/4,000/6,000 step에서 각각 `0.37213`, `0.36103`, `0.35542`였고 마지막
checkpoint가 최적이었다. 이 값은 학습 중 checkpoint 선택용 dev WER이며 기존 고정 평가의 CER나
test 결과가 아니다. 실행 증거와 artifact hash는
[ADR-0047](../../docs/decisions/canola/0047-nemotron-full-finetuning-input-and-runtime.md)에 고정한다.


## vLLM Whisper 서빙 실험

vLLM은 realtime-agent 환경과 섞지 않고 별도 venv에 설치한다. sudo는 필요 없다. 현재
호스트 드라이버가 CUDA 12.8 계열이므로 기본값은 vLLM 0.11.2와 PyTorch cu128이다.

```bash
cd ai/stt-lab
./scripts/bootstrap_vllm.sh
./scripts/serve_vllm_whisper.sh
```

서버는 허용된 GPU 0만 사용하고 `127.0.0.1:18083`에 bind한다. 다른 터미널에서 먼저
golden 3개로 smoke를 실행한다.

```bash
uv run --frozen stt-lab-vllm \
  --manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/golden.jsonl \
  --split golden \
  --limit 3 \
  --concurrency 1 \
  --output results/vllm-golden-smoke.json
```

smoke가 통과하면 dev에서 동시성을 올린다. test는 설정을 확정한 뒤 최종 한 번만 실행한다.

Transformers in-process와 vLLM serving을 모델 선택 근거로 비교할 때는 아래처럼 통합 replay에
둘 다 넣어 동일한 운영 VAD segment plan을 강제한다. API key가 있으면
`STT_LAB_VLLM_API_KEY` 환경변수로만 주입하며 report에는 저장하지 않는다.

```bash
uv run --frozen stt-lab-replay \
  --manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/dev.jsonl \
  --candidate whisper-transformers=whisper@/home/liveclass/ai/models/whisper-large-v3 \
  --candidate whisper-vllm=vllm@liveclass-whisper-large-v3 \
  --vllm-base-url http://127.0.0.1:18083/v1 \
  --mode paced \
  --workers 1 \
  --output results/whisper-serving-vad-dev-c1.json
```

```bash
uv run --frozen stt-lab-vllm \
  --manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/dev.jsonl \
  --split dev \
  --limit 100 \
  --concurrency 1,4,12 \
  --output results/vllm-dev-c1-c4-c12.json
```

보고서에는 요청별 CER·지연·오류와 concurrency별 clips/min, aggregate RTF,
p50/p95/p99 request latency가 저장된다. vLLM은 Whisper를 native streaming model로
바꾸지 않으므로 이 실험은 VAD-final segment의 serving 효과를 측정한다. 처리량 비교에는
동시성 이상 개수의 서로 다른 실제 clip을 사용한다. 같은 무음 파일 반복 결과는 API
통합 smoke일 뿐 모델 품질·처리량 근거로 사용하지 않는다.

## 검증

```bash
uv run --frozen pytest -q -p no:cacheprovider
uv run --frozen ruff check src tests
```
