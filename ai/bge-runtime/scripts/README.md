# `bge-runtime/scripts`

실제 CUDA와 pinned BGE-M3 model을 확인하는 수동 smoke 도구다.

## 역할

- model cache·CUDA device·revision을 확인한다.
- 차원·finite·unit norm·순서와 cold/warm latency, GPU memory를 측정한다.

## 구조와 흐름

`smoke_cuda.py --offline`은 cache가 없으면 다운로드하지 않고 실패한다.

## 파일 구성

`smoke_cuda.py` 하나가 현재 GPU 검증 entrypoint다.

## 경계와 불변식

- 입력 원문과 embedding vector를 출력하지 않는다.
- 단일 smoke 결과를 STT 동시 실행 용량 증거로 사용하지 않는다.

## 검증

`uv run --frozen --extra cuda python scripts/smoke_cuda.py --offline`
