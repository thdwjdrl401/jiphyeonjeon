# STT Lab

한국어 강의 STT 후보를 같은 입력·지표로 비교하는 opt-in GPU 평가 하네스다. 제품
`realtime-agent`와 분리해 운영 중인 LiveKit worker를 재시작하지 않고 실행한다.

## 평가 원칙

- 2~3분 대표 음성 한 개는 빠른 `golden` 회귀 확인에만 사용한다.
- 모델 선택은 speaker-disjoint holdout(최소 100 clip·60분·8명)으로 결정한다.
- golden/test 음성과 정답은 학습 데이터에 넣지 않는다.
- 음성 원본·결과·checkpoint는 Git에 넣지 않는다(`data/`, `results/`, `checkpoints/`).
- 모든 GPU 실행은 현재 허용된 GPU 0만 보이도록 기본 설정한다.

입력은 압축하지 않은 mono PCM16 WAV, 16 kHz여야 한다. manifest는 UTF-8 JSONL이며
필수 필드는 `id`, `audioPath`, `reference`, `language`, `speakerId`, `split`, `consent`다.
학습 manifest는 철자형 정답인 `trainingReference`와 `lectureId`, `category`, `durationMs`도
가진다. `terms`와 파일 무결성 검증용 `sha256`은 선택 필드다.

```json
{"id":"train-ko-tech-001","audioPath":"/data/train-ko-tech-001.wav","reference":"(software)/(소프트웨어)를 사용합니다.","trainingReference":"software를 사용합니다.","language":"ko-KR","speakerId":"speaker-001","lectureId":"lecture-001","category":"eng/comp","durationMs":3200,"split":"train","terms":[],"consent":"AI-Hub-license"}
```

`normalizedCer`는 괄호 쌍의 철자·발음 표기를 각각 정답으로 인정한다. 한 문장 안에서 두
표기가 섞여도 허용한다. 학습 target은 `trainingReference`만 사용하며, 원래 괄호 문자열을
문자 그대로 정규화한 CER는 감사 지표 `literalNormalizedCer`로 함께 남긴다. 로더는 원본
`reference`에서 철자형 target을 다시 만들어 기존 manifest의 괄호 정제 오류를 교정한다.
닫히지 않은 이중 전사처럼 안전하게 복원할 수 없는 sample은 임의 추정하지 않고 학습
selection에서 제외하며 `excludedInvalidReference`에 기록한다.

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
peak CUDA memory를 보존한다. GPU 전체 사용량과 12-stream 동시성은 후속 replay
benchmark에서 별도로 측정한다.

## Whisper large-v3 LoRA pilot

LoRA는 `/home/liveclass/ai/models/whisper-large-v3`의 고정 base checkpoint 위에 학습한다.
기본 pilot은 speaker·lecture·category를 round-robin으로 섞은 train 5시간, 30초 이하 clip,
rank 8, BF16, 1 epoch다. test와 golden은 학습·설정 선택에 사용하지 않는다.

먼저 GPU를 사용하지 않는 selection dry-run을 수행한다.

```bash
uv run --frozen stt-lab-train-lora \
  --base-model /home/liveclass/ai/models/whisper-large-v3 \
  --train-manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/train.jsonl \
  --eval-manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/dev.jsonl \
  --output-dir /home/liveclass/ai/checkpoints/whisper-large-v3-lora/pilot-v1 \
  --dry-run
```

실제 학습 전에는 같은 GPU 0을 쓰는 realtime-agent와 BGE를 maintenance window에서 내린다.
상주 모델과 동시에 메모리에 들어가더라도 compute contention 때문에 라이브 p95를 보장할 수
없다. 두 clip·한 update로 adapter 저장 경로를 먼저 검증한다.

```bash
uv run --frozen stt-lab-train-lora \
  --base-model /home/liveclass/ai/models/whisper-large-v3 \
  --train-manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/train.jsonl \
  --eval-manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/dev.jsonl \
  --output-dir /home/liveclass/ai/checkpoints/whisper-large-v3-lora/smoke-v1 \
  --max-train-clips 2 \
  --eval-limit 2 \
  --batch-size 1 \
  --gradient-accumulation-steps 1 \
  --max-steps 1
```

smoke가 통과하면 `--max-train-clips`, `--max-steps`를 제거해 기본 5시간 pilot을 실행한다.
각 epoch checkpoint와 최종 adapter, config·dataset hash·GPU peak가 output directory에
보존된다. 기존 artifact가 있는 directory는 덮어쓰지 않는다.

학습 후 동일 dev manifest를 base와 adapter에 각각 실행한다. 모델 선택은
`normalizedCer`를 사용하고 `literalNormalizedCer`는 정제 감사에만 사용한다.

```bash
uv run --frozen stt-lab \
  --manifest /home/liveclass/ai/datasets/aihub-korean-lecture/v1/manifests/dev.jsonl \
  --split dev --limit 502 \
  --backend whisper \
  --model /home/liveclass/ai/models/whisper-large-v3 \
  --adapter /home/liveclass/ai/checkpoints/whisper-large-v3-lora/pilot-v1/adapter-final \
  --precision bfloat16 \
  --cuda-visible-devices 0 \
  --output results/whisper-large-v3-lora-dev-502.json
```

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
