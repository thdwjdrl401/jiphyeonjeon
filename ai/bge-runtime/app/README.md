# `bge-runtime/app`

BGE-M3 inference(`cpu`/`cuda`/`cuda:N`)를 제공하는 내부 FastAPI 구현이다.

## 역할

- Bearer 인증을 JSON parsing보다 먼저 수행한다.
- body 시간·크기, batch/text, admission 상한을 강제한다.
- warmup 뒤 readiness를 열고 inference를 직렬화한다.

## 구조와 흐름

```http
POST /internal/v1/embeddings
Authorization: Bearer <token>
Content-Type: application/json

{"model":"BAAI/bge-m3","revision":"5617a9f61b028005a4858fdac845db406aefb181","texts":["질문"]}
```

성공은 `200`과 `{model,revision,dimensions:1024,normalized:true,embeddings:[[...1024개...]]}`다.
오류는 `400` 잘못된 `Content-Length`, `401` 인증, `408` body timeout, `409` model mismatch, `413` body/batch 초과, `422` text/schema,
`429` admission 초과(`Retry-After: 1`)다. `GET /healthz`, `GET /readyz`도 제공한다.

## 파일 구성

`main.py`는 HTTP 경계, `config.py`는 설정, `embedding.py`는 device/model 실행을 담당한다.

## 경계와 불변식

- `cuda`를 요청했는데 CUDA가 없으면 CPU로 fallback하지 않는다. CPU는 `BGE_RUNTIME_DEVICE=cpu`로 명시할 때만 쓴다(ADR-0125).
- 입력 순서와 vector 개수가 같고 각 vector는 finite 1024차원 unit norm이다.
- 입력 text, token, vector를 로그에 남기지 않는다.

## 검증

`uv run --frozen pytest -q -p no:cacheprovider`
