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

이 실행은 품질 향상 증거가 아니라 pipeline 실행 가능성만 증명한다. Nemotron은 현재 추론용
Transformers adapter만 있어 학습 recipe가 연결되지 않았으므로 Whisper dry-run 성공을 Nemotron
학습 완료로 간주하지 않는다.


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
