# ADR-0125: BGE-M3 런타임은 CPU device를 받아들인다

- **상태**: 채택 — 코드·테스트 반영 완료
- **일자**: 2026-08-14
- **관련**: [0013](../canola/0013-bge-m3-runtime-boundary.md)(BGE-M3 GPU runtime 경계 — CUDA 강제를 결정한 ADR),
  [0029](../canola/0029-gpu-bge-ec2-ai-worker-connectivity.md)(GPU↔EC2 터널 — URL만 바꾸면 계약 유지),
  [0031](../canola/0031-bge-rootless-gpu-deployment.md)(rootless GPU 배포)
- **적용 범위**: `ai/bge-runtime/app/embedding.py`, `app/config.py`, `pyproject.toml`, `Dockerfile`

## 한 줄 결정

`BGE_RUNTIME_DEVICE=cpu`를 허용한다. GPU 배포 경로와 `cuda` 기본값은 그대로 두고, **가속기 없는
상시 가동 호스트가 임베딩을 맡을 수 있게** 하는 것이 목적이다.

## 맥락

ADR-0013은 "CUDA가 없으면 CPU로 폴백하지 않고 시작에 실패한다"를 **명시적으로** 결정했다. 그때의
전제는 전용 GPU 서버가 임베딩을 전담하고, 조용한 성능 저하로 그 사실이 가려지면 안 된다는 것이었다.
그 전제가 정당했던 이유도 분명하다 — CPU 폴백이 있으면 GPU가 빠진 배포가 "느리지만 도는" 상태로
넘어가 버린다.

전제가 바뀌었다. GPU 서버가 회수되고, 임베딩은 **항상 켜져 있는 호스트**로 내려온다. 실시간 STT는
노트북 GPU가 계속 맡지만 노트북은 상시 가동이 아니다. 반면 RAG 질의와 자료 인덱싱은 서비스가 살아
있는 내내 가능해야 한다. 둘의 가동 요구가 다르므로 실행 위치도 갈라진다.

CPU가 예산 안에 드는 근거는 ADR-0013이 이미 남겨 두었다. RTX 4050 Laptop 6GB에서 warm 116.8 ms가
측정됐고, 런타임은 `batch_size=4`·`max_batch_size=4`·`max_inflight_requests=8`로 매우 보수적이다.
자료 인덱싱은 오프라인 경로이고, 온라인 경로인 질의 임베딩의 타임아웃 예산은 8초다.

## 결정

`device`가 받는 값을 `cpu` | `cuda` | `cuda:N`으로 넓힌다.

- `parse_device()`를 새로 두어 세 형태를 canonical하게 검증한다. `parse_cuda_device()`는 CUDA 인덱스가
  실제로 필요한 곳(`scripts/smoke_cuda.py`, CUDA 가용성 확인)에 그대로 남는다.
- `ensure_device_available()`은 `cpu`일 때 torch import까지만 확인하고 **CUDA 탐침을 건너뛴다.**
  CPU extra의 torch에는 CUDA 빌드가 없어서, 탐침이 남아 있으면 이 device가 존재하는 이유인 바로 그
  호스트에서 실패한다.
- `pyproject.toml`에 `cpu` extra를 추가한다. torch 버전은 `2.11.0`으로 CUDA 쪽과 **같게** 두고 빌드만
  `+cpu`로 가른다. 두 extra는 `conflicts`로 상호 배타이며, uv source가 extra별 인덱스를 고른다.
- `Dockerfile`은 `ARG TORCH_EXTRA=cuda`로 받는다. 기본값이 `cuda`라 기존 빌드는 바뀌지 않는다.

## 근거

**폴백이 아니라 선언이다.** ADR-0013이 막으려던 것은 *암묵적* 폴백 — CUDA를 요청했는데 조용히 CPU로
내려가는 것 — 이었다. 여기서 `cpu`는 운영자가 명시적으로 고르는 값이고, `cuda`를 요청했는데 GPU가
없으면 **여전히 시작에 실패한다.** 원래 결정의 의도는 그대로 지켜진다.

**HTTP 계약이 device를 모른다.** ai-api·ai-worker는 `AI_API_BGE_BASE_URL` / `AI_WORKER_BGE_RUNTIME_URL`
너머를 보지 않는다. ADR-0029가 남겨 둔 확장점이 그대로 쓰인다 — 호출부는 한 줄도 바뀌지 않는다.

**임베딩 차원이 유지된다.** 1024차원 정규화 dense 벡터와 revision 고정이 그대로라, pgvector에 이미
쌓인 인덱스를 다시 만들 필요가 없다.

## 대안

**OpenAI 임베딩 API로 교체** — 가동 걱정이 사라지지만 벡터 공간이 달라져 기존 임베딩을 전부 다시
만들어야 하고, 차원도 1024가 아니다. 인덱싱 비용과 재작업이 CPU 추론 비용보다 훨씬 크다.

**노트북 GPU에서 BGE도 함께 서빙** — warm 100 ms대로 가장 빠르다. 그러나 노트북이 꺼지면 RAG 질의와
자료 인덱싱이 함께 멎는다. STT는 강의 중에만 필요하지만 임베딩은 그렇지 않다.

**GPU 서버 유지** — 선택지가 아니다. 회수된다.

## 영향·후속

- GPU 배포 스크립트(`deploy/bin/*supervisor`, tmux, `CUDA_VISIBLE_DEVICES=0` 강제)는 **건드리지 않았다.**
  `tests/test_operational_scripts.py`가 검증하는 GPU 경로는 그대로 유효하다.
- CPU 호스트의 메모리 예산을 봐야 한다. FP32 BGE-M3는 모델만 2.2 GB 수준이고 프로세스 RSS는 그보다
  크다. 같은 호스트에 다른 서비스가 얹혀 있으면 이 값이 먼저 한계에 닿는다.
- cold load가 GPU보다 길다. `HEALTHCHECK`의 `start-period=120s`가 여전히 충분한지는 실제 호스트에서
  확인해야 한다.
- 서로 다른 device로 만든 벡터의 수치 동등성은 보장 대상이 아니다. 정규화된 1024차원이라는 계약만
  유지된다 — 검색 품질에 유의미한 차이가 관측되면 별도로 다룬다.
