# ADR-0041: AI Hub 이중 전사는 철자 학습·다중 정답 평가로 처리한다

- **상태**: 채택
- **일자**: 2026-08-03
- **관련**: [ADR-0037](0037-ai-roadmap-and-evaluation-gates.md),
  [ADR-0039](0039-production-vad-stt-experiment-runner.md),
  [ADR-0040](0040-stt-fine-tuning-dry-run-and-promotion.md)

## 맥락

AI Hub 한국어 강의 음성 annotation에는 `(철자 전사)/(발음 전사)`가 들어간다. 예를 들어
`(software)/(소프트웨어)`는 동일 발화의 두 정답 표기다. Nemotron은 한국어 발음 표기를 주로
출력하지만 Whisper는 한국어 전사 모드에서도 영문 기술용어를 그대로 출력할 수 있다.

원본 괄호 문자열을 단일 정답으로 CER에 넣으면 두 모델 모두 실제로 맞힌 단어를 오답으로 계산한다.
반대로 발음 전사 하나만 정답으로 고정하면 영문 철자 출력이 가능한 Whisper를 부당하게 감점한다.
한 문장에 이중 전사가 여러 개 있고 모델 출력이 위치마다 철자와 발음을 섞을 수도 있으므로 문장 전체를
철자 또는 발음 중 하나로만 고르는 것도 충분하지 않다.

## 결정

1. manifest의 `reference`에는 AI Hub 원본 이중 전사를 그대로 보존한다.
2. supervised 학습 target인 `trainingReference`에는 각 쌍의 첫 번째 철자 전사를 사용한다.
   괄호와 슬래시 markup 자체는 모델에 학습시키지 않는다.
3. `normalizedCer`와 `rawCer`는 각 이중 전사 위치에서 철자·발음 중 하나를 선택할 수 있는
   다중 정답 편집거리로 계산한다. `system과 에이피아이` 같은 혼합 출력도 정답이다.
4. 가능한 문장 `2^N`개를 생성하지 않는다. 구간별 편집거리 row를 합치는 동적 계획법으로 계산해
   한 문장에 이중 전사 23개가 있어도 메모리와 시간이 지수적으로 늘지 않게 한다.
5. CER 분모는 정본 자막 표기인 철자 전사의 문자 수로 고정한다. 후보별로 분모가 달라지는 비교를 막는다.
6. 기존 원본 괄호 문자열 기준 normalized CER는 `literalNormalizedCer`로 별도 보존한다.
   모델 선택 지표로 쓰지 않고 과거 결과 해석과 데이터 품질 감사에만 사용한다.
7. 숫자 exact match도 위치별 대안을 따라 계산한다. `(0)/(빵)`은 `0`과 `빵` 모두 정답이다.
8. 확인된 AI Hub 괄호 오타는 제한된 규칙으로 복구하고, 해석되지 않은 이중 전사 markup은
   fail-closed한다.

## 2026-08-03 base 모델 실측 결과

### 실행 조건

이 결과는 모델 선택을 위한 dev 기준선이며 test 결과가 아니다. 동일한 저장 hypothesis를
ADR-0041의 다중 정답 metric으로 재채점했으므로 GPU 추론·VAD 경계·decoding 결과는 최초
실행과 동일하다.

| 항목 | 값 |
|---|---|
| code SHA | `990d03d57d9bdc18a56d531cd9893e9a42005f49` |
| 원본 실행 manifest SHA-256 | `c789e02ad6fb680673c0621040e350f1a9affbe495bc5804865356146d576ee6` |
| 현재 manifest SHA-256 | `51d91b3d6316b762e5df6ed3c235cb94e462cfa0465d8dc95131f18227839f44` |
| 표본 | dev 502 clips, 8 speakers, 9 lectures, 4,435,071 ms(약 73분 55초) |
| 이중 전사 표본 | 139 / 502 clips |
| 공통 VAD segment | 904 |
| 실행 장치 | GPU 0, worker 1 |
| 실행 mode | `accuracy`(offline, audio clock 대기 없음) |
| VAD | 16 kHz, 20 ms frame, min 300 ms, silence 500 ms, max 8,000 ms, pad 200 ms |

현재 manifest는 `trainingReference` 필드 추가로 직렬화 hash가 달라졌다. 기존 artifact와 비교해
502개 clip ID·순서·`reference`가 모두 동일함을 검증했으므로 재채점 표본은 같다.

### 결과

| 후보 | 출력 방식 | multi-ref CER | literal CER | 이중 전사 clip CER | mean RTF | missing final | peak reserved VRAM |
|---|---|---:|---:|---:|---:|---:|---:|
| Nemotron 3.5 ASR Streaming 0.6B | incremental | 23.9964% | 28.1089% | 19.5444% | 0.05690 | 83 | 2.516 GiB |
| Whisper Large V3 BF16 | VAD segment final-only | 16.1193% | 20.2342% | 15.9115% | 0.09039 | 0 | 4.230 GiB |

- Whisper의 전체 multi-ref CER는 Nemotron 대비 상대 **32.83% 감소**했다.
- 이중 전사 139 clips만 비교해도 Whisper CER가 상대 **18.59% 감소**했다.
- Whisper의 mean RTF는 Nemotron의 약 **1.59배**지만 둘 다 이 offline 단일 worker 실행에서는
  RTF 1 미만이다. 이 값은 동시 처리량이나 실시간 p95 지연을 대신하지 않는다.
- Nemotron은 83개 VAD segment에서 final을 만들지 못해 이 실행의 운영 무결성 gate가 실패했다.
  Whisper는 missing final이 0이었다.
- Whisper가 `return`, `FPS`, `DJI` 같은 영문 표기를 실제 출력한 sample이 확인됐다.
  따라서 발음 전사만 정답으로 고정하면 Whisper를 부당하게 감점한다.
- 예를 들어 `(benzene)/(벤젠)이죠.`에 대한 Whisper 출력 `벤젠이죠`는 literal CER 63.64%였지만
  multi-ref CER는 0%다. 원본 괄호 markup을 모델 선택 지표로 사용할 수 없음을 보여준다.

### 현재 판단과 후속 선택 기준

이 dev 기준선에서는 **Whisper Large V3를 정확도 선두 후보**로 둔다. 다만 이 결과만으로 운영 모델을
확정하지 않는다. 후보 승격은 다음 순서와 gate를 모두 적용한다.

1. 정확도 비교의 정본은 `normalizedCer` multi-ref CER다. `literalNormalizedCer`는 선택에
   사용하지 않는다.
2. `missingFinalCount`, warning, timeout, frame/segment drop은 모두 0이어야 한다.
3. 같은 checkpoint·VAD·decoding에서 paced replay와 concurrency 1/4/12를 실행해 p50/p95 final
   latency, backlog, aggregate RTF, peak VRAM을 비교한다.
4. 침묵 hallucination과 강의와 무관한 상투 문구 출력을 별도 집계한다. 현재 Whisper 결과에서
   `MBC 뉴스 김성현입니다.`가 두 clips에 나타났으므로 배포 전 원인과 억제 설정을 확인한다.
5. dev에서 모델·precision·decoding을 고정한 뒤 test split은 최종 1회만 실행한다.
6. fine-tuned checkpoint는 ADR-0040의 base 대비 domain CER 상대 10% 개선 및 일반 한국어
   holdout 악화 2%p 이하 gate를 추가로 만족해야 한다.

따라서 현재 결론은 “Whisper 정확도 우세”이며 “Whisper 운영 채택 완료”가 아니다. Nemotron은
missing final 문제를 수정한 동일 조건 재실행 전까지 운영 후보 승격 대상에서 제외한다.

### 재현 artifact

- 원본 실행:
  `/home/liveclass/ai/experiments/stt-20260803-baseline/replay-dev-benchmark-502-c1-artifacts/`
- 다중 정답 재채점:
  `/home/liveclass/ai/experiments/stt-20260803-baseline/replay-dev-benchmark-502-c1-artifacts/multi-reference-rescore.json`
- 학습 preflight:
  `/home/liveclass/ai/experiments/stt-20260803-baseline/training-preflight-multiref.json`

## 대안

| 대안 | 판단 |
|---|---|
| 원본 괄호 문자열을 단일 reference로 사용 | 정답 출력도 괄호 부재 때문에 오답이 되어 기각 |
| 발음 전사만 정답으로 사용 | 영문 철자 출력을 부당하게 감점해 기각 |
| 문장 전체를 철자/발음 두 개 reference로만 생성 | 위치별 혼합 출력을 처리하지 못해 기각 |
| 모든 조합을 미리 열거 | 이중 전사 수에 따라 지수적으로 증가해 기각 |
| 철자 전사 학습 + 위치별 다중 정답 평가 | 서비스 자막 표기와 모델 간 공정성을 함께 만족해 채택 |

## 영향과 검증

- 이 변경은 실험 manifest와 평가 artifact 내부 계약이다. Spring·FE·Redis payload와 상태코드는
  바뀌지 않으므로 `docs/CONTRACT.md` 및 FE/BE 계약 테스트 변경은 불필요하다.
- 단위 테스트는 철자 전사, 발음 전사, 두 표기의 혼합, 숫자 대안, 23개 대안 문장을 검증한다.
- AI Hub 변환 audit에는 이중 전사 sample 수를 기록한다.
- 기존 모델 추론 결과는 다시 GPU 추론하지 않고 저장된 hypothesis를 새 metric으로 재채점할 수 있다.
