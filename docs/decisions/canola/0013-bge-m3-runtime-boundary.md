# ADR-0013: BGE-M3는 bounded AI 내부 GPU runtime으로 분리한다

- **상태**: 채택
- **일자**: 2026-07-27

## 맥락

원본 `feat/ai/mvp-service-scaffold`의 `2fa25b9`는 standalone BGE runtime, remote client,
Docker/Compose와 RAG wiring을 한 커밋에 포함한다. 현재 분할 계획에서는 caption/material 공용
계약이 아직 열리지 않았지만 BGE runtime 자체는 그 계약과 독립적이다. 반면 원본 adapter는
`asyncio.Lock` 안에서 `asyncio.to_thread()`를 기다려, HTTP 요청 취소 시 lock이 먼저 풀리고 실제
CUDA thread가 다음 추론과 겹칠 수 있다. 요청 대기 수도 제한되지 않는다.

[공식 BGE-M3 모델](https://huggingface.co/BAAI/bge-m3)은 dense embedding 차원이 1024이고 최대
sequence length가 8192인 모델이다. 기본 revision은 Hugging Face의 verified commit
[`5617a9f61b028005a4858fdac845db406aefb181`](https://huggingface.co/BAAI/bge-m3/commits/5617a9f61b028005a4858fdac845db406aefb181)로 고정한다.

## 결정

1. `bge-runtime`은 저장소·queue·Java credential을 갖지 않는 독립 AI HTTP process로 둔다.
   `/internal/v1/embeddings`는 향후 Python caller만 사용하는 내부 경계이므로 이번 MR에서
   `docs/CONTRACT.md`, backend와 frontend를 바꾸지 않는다.
2. Bearer token은 request body parsing 전에 constant-time 비교하며 실패 시 `401`과
   `WWW-Authenticate: Bearer`를 반환한다. 원문과 vector, token은 로그에 남기지 않는다.
   Docker 배치 전 로컬 기본 bind는 `127.0.0.1`로 제한한다.
3. device는 canonical `cuda`/`cuda:N`만 허용한다. CUDA가 없거나 index가 유효하지 않으면 CPU로
   fallback하지 않고 시작을 실패시킨다.
4. 기본 CI dependency와 실제 CUDA dependency를 분리한다. FastAPI/config/test는 base에서,
   SentenceTransformers와 exact `torch==2.13.0+cu130`은 `cuda` extra에서 관리한다.
5. model load와 encode는 OS thread 안의 lock으로 직렬화한다. coroutine이 취소되어도 실제 CUDA
   thread가 끝날 때까지 취소 전파와 admission 반환을 미루므로 다음 추론과 겹치거나 취소를 통해
   bounded queue를 우회하지 못한다.
6. 기본 한도는 request body 128 KiB/수신 5초, request batch 4, encoder batch 4, text 4,000자,
   active+queued HTTP request 8이다. 인증 후 body parsing 전에 declared/chunked body 크기와
   수신 시간을 검사하고, admission 초과는 `429`와 `Retry-After: 1`로 즉시 거부한다. 이 숫자는
   보수적 시작값이며 실제 최대 입력 CUDA smoke 없이 상향하지 않는다.
7. model output은 입력 개수와 순서를 유지한 1024차원 finite unit vector인지 runtime에서 다시
   검증한다. model/revision 불일치는 `409`로 거부한다.
8. 이 단계에는 ai-api/worker caller, retrieval/storage, Dockerfile, Compose, root env/RUN을 넣지
   않는다. caller는 retrieval MR, image와 local 배치는 최종 `ai-local-runtime` MR에서 연결한다.

## 영향과 검증 한계

- fake encoder/device로 인증, schema, readiness, 출력 불변식, bounded overload, lazy load와
  cancellation 직렬화를 기본 테스트에서 검증한다.
- 문자 수는 tokenizer token 수와 동일하지 않으므로 8192-token 경계를 대신하는 정확한 보장은
  아니다. 실제 자료 분포와 최대 허용 batch의 VRAM/latency를 별도 측정해야 한다.
- 실제 BGE model/CUDA smoke는 base 테스트와 구분해 full revision, cold/warm latency, peak
  allocated/reserved를 기록한다.
- 2026-07-27 RTX 4050 Laptop 6 GB에서 짧은 입력 2개 offline smoke 결과는 2×1024,
  finite/unit norm, cold 39.3초, warm 116.8ms, peak allocated 2175.4 MiB / reserved
  2188.0 MiB였다. 이는 최대 batch나 다른 모델과의 동시 상주 근거가 아니다.
- BGE 단독 실행 결과로 Nemotron과 6 GB GPU 동시 상주가 안전하다고 추론하지 않는다. 동시 실행은
  realtime lifecycle wiring 전 별도 검증 대상이다.
- Docker/NVIDIA Container Toolkit과 persistent model cache 동작은 이번 소스 MR의 완료 조건이
  아니며 `ai-local-runtime`에서 검증한다.
