# ADR-0037: AI 후속 로드맵을 VOD RAG·STT 특화·판서 변환 순으로 진행한다

- 상태: 승인
- 일자: 2026-08-01
- 적용 범위: `ai-api`, `ai-worker`, `bge-runtime`, `realtime-agent`, AI 실험 harness

## 맥락

현재 AI 후속 작업은 다음 세 트랙으로 나뉘다.

1. 한국어 강의 STT 모델 비교·fine-tuning·경량 배포
2. Excalidraw 판서를 LaTeX 수식·Mermaid 다이어그램·편집 가능한 도형으로 변환
3. 재생 시간과 근거 citation이 연결되는 VOD RAG 질의 완성

세 트랙은 모두 모델 품질을 다루지만 출발점이 다르다. STT는 provider 교체와
GPU 12-room 배포 구조가 있지만 학습·평가 corpus가 없다. AI 판서는 Excalidraw JSON 통신과
UniMERNet 실험 자산이 있지만 제품 변환 계약과 평가셋이 없다. RAG는 주요 구성요소가
구현됐지만 Spring→AI 요청, 자료 scope, VOD 자막 시간축에 런타임 계약 공백이 있다.

모델 하나의 예제 입력에서 잘 동작한 결과로 fine-tuning·배포 모델을 선택하면 과적합과
서비스 운영 회귀를 검출할 수 없다. 따라서 세 트랙 모두 구현 전에 고정 평가 계약과
holdout을 먼저 만들어야 한다.

## 결정

### 1. 우선순위

한 담당자가 순차 진행할 때 제품 완성 순서는 다음과 같다.

1. **VOD RAG 계약 정합과 E2E 완성**: 이미 있는 자산을 살리고 현재 라이브 RAG까지
   막는 wire 불일치를 먼저 제거한다.
2. **STT 평가·특화**: 음성 데이터 수집에 시간이 걸리므로 RAG와 병행해 corpus를
   만들고, 평가 harness 완성 후 학습·경량화한다.
3. **AI 판서 제품화**: 수식 OCR POC와 fixture 수집은 병행하되, 전체 제품 연동은
   RAG E2E 후에 진행한다.

각 트랙의 데이터 수집·평가 harness는 모델 개발 선행 작업이므로 위 순서와 관계없이 조기에
착수할 수 있다.

### 2. STT 특화 트랙

`gpt-realtime-whisper`는 관리형 API baseline이며 공개 가중치 fine-tuning 대상이 아니다.
실제 학습 비교 대상은 공개 Whisper 가중치와 Nemotron 3.5 ASR이다. 따라서 다음 세
baseline을 분리해 비교한다.

| baseline | 역할 |
|---|---|
| `gpt-realtime-whisper` | API 품질·지연·비용 상한선 |
| 공개 Whisper (`large-v3` 정확도 후보, `turbo` 효율 후보) | 로컬 fine-tuning·자체 배포 후보 |
| Nemotron 3.5 ASR Streaming 0.6B | native streaming fine-tuning·자체 배포 후보 |

단일 2~3분 대표 음성은 매일 실행하는 **golden smoke**로만 사용한다. 모델 선택은
최소 100 clip·60분·8명 이상 화자의 speaker-disjoint holdout과 30분 연속 강의, 12-stream
replay를 기준으로 한다. fine-tuning pilot은 정확히 라벨링한 5~10시간으로 시작한다.

필수 평가 항목은 다음과 같다.

- normalized Korean CER, 원문 CER, 기술용어 recall/F1, 숫자 exact match, 침묵 hallucination
- speech-start→first-delta, speech-end→final p50/p95/p99, RTF, backlog, segment/frame drop
- 1/12 동시, prod 12 + dev 1 + BGE 혼합 부하, VRAM, GPU utilization, 30분 soak
- API 음성 분당 비용과 로컬 GPU 시간·전력·운영 비용

fine-tuned model은 domain CER가 base 대비 상대 10% 이상 개선되고 일반 한국어 holdout
CER 악화가 2%p 이하일 때만 배포 후보로 승격한다. 경량화는 BF16/FP16 baseline,
compile/runtime 최적화, INT8 순으로 한 단계씩 적용하고 매 단계에서 정확도와 용량을
다시 측정한다.

#### 2.1. AI Hub 데이터 배치와 정본

대용량 원본·정답·파생 음성은 Git 저장소에 넣지 않는다. GPU 호스트의 AI 자산 루트를
`${LIVECLASS_AI_HOME:-$HOME/ai}`로 두며, 현재 호스트의 실제 경로는 다음과 같다.

```text
/home/liveclass/ai/datasets/aihub-korean-lecture/v1/
├── raw/
│   ├── audio/                 # 내려받은 원문 음성; 원래 디렉터리 구조 보존
│   └── annotations/           # 내려받은 구조화 JSON; 원본 수정 금지
├── derived/
│   └── audio-16k-mono/        # 변환이 필요한 파일만 생성, 원본 덮어쓰기 금지
├── manifests/
│   ├── source-index.jsonl     # audio와 JSON 연결, 원본 metadata 보존
│   ├── train.jsonl
│   ├── dev.jsonl
│   ├── test.jsonl
│   └── golden.jsonl
└── reports/
    ├── audit.json
    └── split-summary.json
```

음성과 JSON이 서로 다른 디렉터리에 있어도 복사·평탄화하지 않는다. `source-index.jsonl`이
두 절대경로를 연결한다. 파일명만으로 연결하지 말고 AI Hub sample ID 또는 JSON의
`audioPath`를 우선 사용한다. 원본은 read-only로 취급하고 resample, 정규화, 무음 삽입 등
재생산 가능한 변환만 `derived/`에 쓴다.

실험 코드와 작은 example manifest만 `ai/stt-lab`에 추적한다. 실제 manifest, 음성,
checkpoint, run 결과는 데이터 루트에 저장하고 run artifact에는 dataset manifest SHA-256만
기록한다. manifest의 최소 필드는 `id`, `audioPath`, `reference`, `language`, `speakerId`,
`split`, `consent`, `sha256`이며 source index에는 `lectureId`, `category`, `durationMs`,
`annotationPath`도 보존한다.

split은 clip 랜덤 분할이 아니라 `(speakerId, lectureId)` group 단위 80/10/10을 기본으로
한다. 동일 화자 또는 동일 강의의 인접 발화가 두 split에 걸치면 누수로 보고 split을 다시
만든다. `dev`는 모델·VAD·chunk·serving 설정 선택에 사용하고 `test`는 설정을 고정한 뒤
최종 비교에 한 번만 사용한다.

#### 2.2. 하루 STT 실험 스프린트

하루 실험의 목표는 최고 점수 하나를 만드는 것이 아니라 이후 학습·경량화 결과를 비교할
수 있는 고정 기준을 남기는 것이다. 아래 순서를 지키며 앞 단계 artifact가 없으면 다음
단계 결과를 모델 선택 근거로 사용하지 않는다.

| 우선순위 | 실험 | 비교·측정 | 오늘의 산출물·중단 조건 |
|---|---|---|---|
| P0 | `E0` 데이터 audit | audio↔JSON 매칭률, 총 시간, 화자·강의·분야 분포, sample rate/channel, 빈 전사·중복·손상 파일 | `audit.json`; 매칭 실패 원인을 분류하고 임의 제외하지 않는다 |
| P0 | `E1` 누수 없는 split 고정 | `(speakerId, lectureId)` group 80/10/10, split 간 화자·강의 교집합 0, 최소 test 100 clip·60분·8명 | 4개 manifest, `split-summary.json`, manifest SHA-256 |
| P0 | `E2` base 모델 정확도 | 같은 입력·정규화·한국어 고정 조건에서 Nemotron base와 Whisper large-v3 base의 normalized/raw CER, 숫자 exact match, 용어 F1, 무음 hallucination | dev로 설정을 정한 뒤 고정 test를 각 모델 1회 실행한 per-sample JSONL과 요약표 |
| P0 | `E3` 실제 스트리밍 replay | 20 ms 입력에서 Nemotron 320/560/1120 ms와 Whisper VAD-final의 first-delta/final p50·p95, RTF, backlog, 중복·누락 | 정확도와 지연의 Pareto 표; 30분 연속 replay에서 drop이 있으면 해당 설정 제외 |
| P0 | `E4` Whisper serving A/B | 같은 large-v3 checkpoint·precision·decoding·VAD segment를 Transformers in-process와 vLLM server로 각각 concurrency 1/4/12 실행 | warm/cold latency, clips/min, RTF, peak VRAM, 실패율, CER 차이; 설정이 같지 않으면 결과 폐기 |
| P1 | `E5` 소규모 fine-tuning pilot | E0~E4 완료 후 train 5~10시간으로 base와 fine-tuned valid CER 비교; test 사용 금지 | checkpoint, 학습/valid curve, config·seed·dataset hash. 시간 부족 시 학습보다 재현 가능한 dry-run을 우선 |
| P2 | `E6` 최적화 예비 실험 | 승자 후보 하나에만 BF16/FP16을 기준으로 compile 또는 INT8 한 가지만 적용 | CER·p95·RTF·VRAM 전후표; 오늘 필수 아님, 정확도 없이 속도만 보고 채택 금지 |

오늘 반드시 완료할 범위는 `E0`~`E4`다. `E5`는 데이터 정합과 baseline이 끝났을 때만
실행하며, `E6`, 12-stream 30분 soak, prod 12 + dev 1 + BGE 혼합 부하는 후속 실험으로
남긴다. 한 번의 하루 실험으로 fine-tuned 모델의 운영 승격을 선언하지 않는다.

#### 2.3. vLLM 서빙 판단

vLLM 도입 효과는 모델 정확도와 분리해 판단한다. 기대하는 이점은 model residency,
동시 요청 scheduling/batching, 표준화된 OpenAI-compatible transcription API, 프로세스별
중복 model load 제거다. 이는 주로 처리량·VRAM 운영·배포 경계를 개선하며 같은 checkpoint의
CER를 자동으로 높이지 않는다.

Whisper를 vLLM에 올려도 모델이 Nemotron과 같은 cache-aware native streaming 구조로
바뀌지는 않는다. 실시간 경로에서는 여전히 VAD/commit 단위 audio buffer 또는 겹치는
window가 필요하고, partial을 내보낼 때는 stable-prefix 또는 자막 revision 계약이 필요하다.
따라서 `E4`에서는 현재 append-only 자막 계약을 유지하는 VAD-final 입력부터 비교한다.

vLLM의 beam search는 encoder-decoder model에서 cache 처리가 아직 비효율적이라고 공식
문서가 명시하므로 첫 비교는 greedy decoding으로 고정한다. vLLM 채택 gate는 다음과 같다.

- 동일 checkpoint·precision·decoding에서 normalized CER 절대 차이가 0.1%p 이하다.
- concurrency 12에서 current per-job in-process topology 대비 clips/min이 20% 이상
  증가하거나 p95 final latency가 15% 이상 감소한다.
- shared vLLM server 한 번의 model load와 current topology 전체를 각각 측정해 peak VRAM이
  악화되지 않는다.
- 30분 soak에서 OOM, 요청 오류, timeout, 자막 누락이 모두 0이다.
- 실시간 자막 계약을 깨는 correction/retraction을 요구하지 않는다.

Nemotron은 vLLM 대상에 억지로 맞추지 않고 NeMo cache-aware streaming pipeline을 기준으로
평가한다. 즉 `model A 대 model B`와 `Transformers 대 vLLM`을 한 비교표에 섞지 않는다.

### 3. AI 판서 트랙

Excalidraw scene JSON을 정본으로 유지하고 사용자가 선택한 영역의 raster crop은 보조
입력으로만 쓴다. 판서 전체를 범용 VLM에 이미지로 보내지 않고 다음처럼 routing한다.

| route | 처리 |
|---|---|
| `FORMULA` | crop + freedraw→수식 OCR→`FormulaIR`→검증된 LaTeX |
| `DIAGRAM` | scene JSON→node/edge/text `DiagramIR`→Mermaid→Excalidraw |
| `SHAPE` | points/bounds→기하 알고리즘→표준 Excalidraw 도형 |
| `MIXED/UNKNOWN` | 자동 적용 금지, preview 또는 사용자 mode 선택 |

수식은 UniMERNet, PP-FormulaNet, 손글씨 특화 모델과 범용 VLM을 동일 자체 평가셋에서
비교한다. 특화 모델은 범용 baseline보다 핵심 정확도가 3%p 이상 높거나, 동등 품질에서
지연·비용이 절반 이하일 때만 채택한다.

모델이 Excalidraw raw JSON을 직접 생성하게 하지 않고 strict schema IR만 생성하게 한다. 서버가
좌표, node/edge 상한, dangling edge, Mermaid parse, LaTeX command allowlist를 검증한 후 결정론적으로
Excalidraw 요소를 만든다. 원본을 자동 교체하지 않고 강사 preview·승인 후에만 반영한다.

첫 MVP에서 LaTeX는 preview/copy로 제공한다. LaTeX 렌더를 Excalidraw image element로 영속화하는
일은 BinaryFiles 전송·저장 계약을 별도 ADR로 확정한 후 진행한다.

### 4. VOD RAG 트랙

신규 모델 튜닝 전에 다음 계약 공백을 먼저 닫는다.

1. Spring→ai-api RAG wire에 필수 `curriculumId`를 추가한다.
2. 자료 scope를 `CURRICULUM | LESSON`으로 확정하고 worker DTO의 `lessonId`를 scope에
   따라 조건부로 받는다.
3. `ai.material_version.lesson_id`를 nullable로 변경하고 검색은 `curriculum 공통 + 현재
   lesson`으로 scope한다.
4. Spring이 라이브 종료·자막 확정 후 `TRANSCRIPT_INDEX` outbox job을 낸다. worker는
   HMAC snapshot endpoint에서 권위 `caption.segment.final`을 읽어 VOD transcript version을
   chunk·embed·index한다.
5. transcript chunk는 `curriculumId`, `lessonId`, `sessionId`, `startSessionMs`, `endSessionMs`를
   저장하고 질문 시각 이후 근거를 제외한다.
6. VOD 질의는 playback과 같은 게시·소유·수강 권한을 Spring이 검증하고 Spring→ai-api
   SSE를 사용한다. citation은 PPTX page 또는 HLS `sessionMs` seek로 연결한다.

완료 gate는 자료 attach→queue→BGE→pgvector→callback→VOD query→SSE→citation seek 전체
E2E다. 품질은 PPTX 단독, 자막 단독, 혼합, 시점 이후, 근거 없음, 다른 scope 유출 유도
질문으로 Recall@K/MRR/nDCG, citation accuracy, faithfulness, refusal precision/recall,
TTFT·전체 p95를 측정한다.

### 5. 공통 평가·배포 규칙

- golden smoke는 매 변경의 빠른 회귀 확인이고 모델 선택 근거가 아니다.
- train/dev/test를 화자·필기자·강의 단위로 분리하고 test를 fine-tuning·threshold
  조정에 사용하지 않는다.
- run에 code SHA, model revision/checkpoint digest, dataset hash, config, seed, precision, hardware,
  dependency version을 저장한다.
- per-sample 결과와 요약 p50/p95/p99, 비용, VRAM, 오류를 machine-readable artifact로 남긴다.
- 외부 API·GPU 실험은 기본 unit/contract gate와 분리한 opt-in test로 운영한다.
- 승자 모델은 새 agent/model revision으로 canary하고 이전 checkpoint를 rollback 대상으로
  유지한다.

### 6. 팀 경계

AI 팀은 학습·평가 harness, worker·ai-api·realtime-agent, pgvector schema·retrieval,
model adapter, AI readiness·metrics를 소유한다. Spring 팀은 공개 권한 gate, outbox, signed source,
callback/inbox, SSE proxy, VOD 시간축 변환을 소유한다. FE 팀은 판서 선택·preview·승인,
VOD citation seek를 소유한다.

공유 DTO, stream/queue payload, 상태코드가 바뀌면 루트 `docs/CONTRACT.md`와 구현 양쪽 계약
테스트를 같은 변경에서 갱신한다.

## 결과

- VOD RAG는 모델 튜닝보다 wire·scope·시간축 정합을 완료 조건으로 둔다.
- STT fine-tuning은 base 비교와 holdout이 준비된 후에만 시작하여 불필요한 GPU 학습을
  막는다.
- AI 판서는 구조화된 Excalidraw 정보를 버리지 않고 특화 모델 호출 범위를 줄인다.
- 어떤 트랙이든 단일 예제 성공을 배포 근거로 삼지 않고 재현 가능한 평가 artifact와
  hard gate를 남긴다.

## 참고

- [STT provider·overload 경계](0012-realtime-stt-provider-and-overload-boundary.md)
- [STT 12-room 동시성·배치](0026-realtime-stt-concurrency-and-batching.md)
- [GPU 공유 runtime 후보](0027-realtime-stt-shared-gpu-runtime.md)
- [provider profile·warm pool](0028-stt-provider-execution-profile-and-warm-pool.md)
- [운영 VAD 기반 STT 통합 실험](0039-production-vad-stt-experiment-runner.md)
- [STT fine-tuning dry-run·승격](0040-stt-fine-tuning-dry-run-and-promotion.md)
- [AI 통신 계약](../../ai/CONTRACT.md)
- [Excalidraw 판서 계약](../songjeongki/0051-instructor-annotation-excalidraw.md)
- [AI Hub 한국어 강의 음성](https://www.aihub.or.kr/aihubdata/data/view.do?aihubDataSe=data&currMenu=115&dataSetSn=115&topMenu=100)
- [vLLM Speech-to-Text API](https://docs.vllm.ai/en/stable/serving/online_serving/speech_to_text/)
- [vLLM Speech-to-Text chunk 설정](https://docs.vllm.ai/en/stable/api/vllm/config/speech_to_text/)
- [NeMo streaming inference](https://docs.nvidia.com/nemo/speech/nightly/asr/inference.html)
