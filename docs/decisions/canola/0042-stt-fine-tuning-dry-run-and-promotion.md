# ADR-0040: STT fine-tuning은 train/dev dry-run과 운영 VAD 승격 gate를 거친다

- **상태**: 채택
- **일자**: 2026-08-03
- **관련**: [ADR-0037](0037-ai-roadmap-and-evaluation-gates.md),
  [ADR-0039](0039-production-vad-stt-experiment-runner.md)

## 맥락

AI Hub 한국어 강의 음성으로 Whisper와 Nemotron을 특화하려면 데이터 변환, 학습, checkpoint 저장,
재로드와 평가가 이어져야 한다. 데이터 업로드를 기다린 뒤 학습 코드를 처음 실행하면 schema·dtype·GPU
메모리·checkpoint 호환 문제 때문에 실험 시간을 잃는다. 반대로 학습 loss 감소만으로 모델을 선택하면
실제 서비스 VAD segment에서 CER·지연·hallucination이 나빠지는 회귀를 놓친다.

supervised 원본 clip에는 clip 전체 transcript가 붙어 있다. 운영 VAD가 원본 clip을 더 잘게 자르면 각
sub-segment에 대응하는 정답 문자열이 없으므로, VAD로 임의 분할한 음성과 전체 transcript를 학습 pair로
사용해서는 안 된다. 학습 입력 경계와 서비스 평가 경계의 역할을 분리해야 한다.

## 결정

### 1. 학습 manifest와 평가 manifest를 분리한다

- `train`과 `dev`만 학습 pipeline이 읽을 수 있다.
- `test`와 `golden` 경로가 학습 config에 들어오면 fail-closed한다.
- 원본 JSON transcript와 원본 utterance WAV를 supervised training pair로 사용한다.
- VAD로 분리한 sub-segment는 해당 구간의 정렬 transcript가 있을 때만 학습 데이터로 허용한다.
- split은 ADR-0037의 `(speakerId, lectureId)` connected component 80/10/10을 유지한다.
- manifest SHA-256, AI Hub license/consent, 제외 sample과 이유를 모든 run에 기록한다.

즉 VAD는 라벨이 없는 학습 데이터 절단 도구가 아니다. base와 fine-tuned 모델의 비교·승격은 모두
ADR-0039의 동일한 운영 `VadSegmenter` replay를 통과한다.

### 2. 공통 학습 example과 모델별 adapter를 둔다

정본 `TrainingExample`은 최소한 다음을 가진다.

- id, audio path, transcript, language
- speakerId, lectureId, split, durationMs
- audio/manifest hash와 consent

Whisper adapter는 processor feature와 decoder label을 만들고, Nemotron adapter는 해당 학습 runtime이
요구하는 feature·token target으로 변환한다. 모델별 전처리 cache는 checkpoint·processor revision과
manifest hash를 key로 사용하며 원본을 덮어쓰지 않는다.

학습 framework에 맞추기 위해 manifest 의미를 바꾸지 않는다. 특정 모델 학습 API가 한 step 저장·재로드
검증을 통과하지 못하면 그 모델은 `TRAINING_UNSUPPORTED`로 기록하고 억지 wrapper로 완료 처리하지 않는다.

### 3. 데이터 전 dry-run을 필수로 한다

실제 pilot 전에 비민감 합성 WAV와 짧은 transcript fixture로 다음을 실행한다.

1. train batch 2개 이상 load
2. forward와 loss 계산
3. optimizer 1 step
4. dev evaluation 1 step
5. checkpoint와 processor/tokenizer 저장
6. 새 process에서 checkpoint 재로드
7. ADR-0039 운영 VAD golden replay 1회
8. 종료 후 CUDA memory와 process 반환 확인

dry-run은 학습 품질 증거가 아니라 pipeline 실행 가능성 증거다. loss 개선이나 합성 CER를 모델 성능으로
보고하지 않는다.

### 4. pilot과 tuning 순서를 고정한다

1. base checkpoint를 ADR-0039의 고정 dev에서 평가한다.
2. 정확히 라벨링된 train 5~10시간으로 작은 pilot을 수행한다.
3. dev에서 checkpoint와 decoding 설정을 선택한다.
4. 일반 한국어 dev와 강의 domain dev를 함께 비교한다.
5. 한 후보를 고정한 뒤 test를 최종 1회 실행한다.

첫 pilot은 full fine-tuning과 LoRA를 동시에 무작정 sweep하지 않는다. 모델별 메모리·학습 지원 상태를
dry-run으로 확인한 뒤 하나의 기준 방식을 선택하고, 다른 방식은 동일 seed·data·step 수의 명시적인 A/B로
추가한다. augmentation, pseudo-label, VAD threshold, decoding 설정을 한 run에서 동시에 바꾸지 않는다.

### 5. checkpoint artifact와 resume 계약을 고정한다

각 학습 run은 Git 밖 artifact root에 다음을 저장한다.

```text
checkpoints/<runId>/
├── config.json
├── dataset.json
├── trainer-state.json
├── metrics.jsonl
├── checkpoint/             # model 또는 adapter weight
├── processor/              # tokenizer/processor revision
└── evaluation/             # ADR-0039 report 링크와 digest
```

`config.json`에는 base model revision, method(full/LoRA), seed, precision, optimizer, learning rate,
batch/gradient accumulation, epoch/step, scheduler, max audio/text length를 저장한다. secret, 원본 음성,
개인 식별 metadata는 checkpoint에 넣지 않는다.

resume는 저장 직후가 아니라 새 process에서 optimizer/scheduler state와 weight를 읽고 다음 step을 수행해
검증한다. LoRA를 사용하면 adapter 원본을 정본으로 보존하고 merge weight는 별도 파생 artifact로 만든다.

### 6. 승격은 동일 VAD report의 hard gate로 판정한다

fine-tuned checkpoint는 다음을 모두 만족해야 배포 후보가 된다.

- domain test normalized CER가 base 대비 상대 10% 이상 개선
- 일반 한국어 holdout CER 악화가 절대 2%p 이하
- 숫자 exact match와 핵심 용어 recall이 base보다 악화되지 않음
- silence hallucination, 빈 final, 중복·누락 segment가 base보다 악화되지 않음
- paced/concurrency 12에서 frame·segment drop, OOM, timeout 0
- p95 final latency와 peak VRAM이 현재 운영 cap을 깨지 않음
- 30분 replay와 실제 LiveKit canary에서 caption sequence·시간축 회귀 0

gate 미달 checkpoint도 삭제하지 않고 `REJECTED` 상태와 이유를 report에 남긴다. 승격 모델은 새로운
model revision/provider profile로 canary하고 base checkpoint를 rollback 대상으로 유지한다.

### 7. 자동 report는 ADR-0039 schema를 재사용한다

base, fine-tuned, serving/precision 후보는 ADR-0039의 같은 `segment-plan.jsonl`, `samples.jsonl`,
`summary.json`, `comparison.csv`, `report.md`를 사용한다. 학습 loss graph는 부가 artifact이며 모델 선택
정본은 동일 운영 VAD의 dev/test report다.

## 대안

| 대안 | 판단 |
|---|---|
| 업로드 완료 후 바로 전체 학습 | schema·checkpoint 오류를 늦게 발견해 기각 |
| 운영 VAD segment에 전체 clip transcript를 붙여 학습 | label misalignment로 기각 |
| 학습 loss만으로 checkpoint 선택 | 서비스 정확도·지연 회귀를 못 잡아 기각 |
| test로 hyperparameter 선택 | holdout 오염으로 기각 |
| dry-run→소규모 pilot→동일 VAD dev/test 승격 | 실패 비용과 평가 누수를 줄여 채택 |

## 구현 순서

1. `TrainingExample` loader와 split guard를 추가한다.
2. 합성 fixture로 Whisper training adapter의 one-step/save/reload를 구현한다.
3. Nemotron 학습 runtime을 확인하고 같은 dry-run 계약을 구현하거나 미지원 상태를 명시한다.
4. checkpoint metadata·resume 검증과 artifact writer를 추가한다.
5. ADR-0039 runner에 fine-tuned checkpoint adapter를 연결한다.
6. 실제 데이터 audit 완료 후 5~10시간 pilot을 시작한다.

## 영향과 검증

- 이 ADR은 실험·학습 내부 경계이며 Spring/FE/Redis payload와 상태코드를 바꾸지 않는다.
  `docs/CONTRACT.md` 갱신과 공유 계약 테스트는 필요하지 않다.
- 단위 테스트는 train/dev 허용, golden/test 거부, speaker/lecture leakage 거부, deterministic batch,
  one-step/save/reload, artifact secret 제외를 검증한다.
- GPU 학습은 opt-in으로 분리하고 GPU 0만 사용한다. 운영 realtime-agent·BGE가 사용하는 memory를 먼저
  확인하고 여유가 없으면 실행하지 않는다.
- 구현 완료 보고에는 실제 dry-run log, checkpoint 재로드, ADR-0039 golden replay와 CUDA 반환 증거를
  첨부한다. 빈 stub, skip, 학습되지 않은 checkpoint를 완료로 보고하지 않는다.
