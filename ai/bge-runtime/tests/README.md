# `bge-runtime/tests`

HTTP 보호 경계, 설정과 embedding wrapper를 GPU 없이 검증한다.

## 역할

- 인증 선행, body timeout/size, admission과 상태코드를 검증한다.
- CUDA 설정, lazy load, 직렬화와 vector 불변식을 검증한다.

## 구조와 흐름

fake ASGI body와 encoder/device validator를 사용한다.

## 파일 구성

`test_api.py`, `test_config.py`, `test_embedding.py`, `test_operational_scripts.py`,
`test_reverse_tunnel_script.py`로 구성된다.

## 경계와 불변식

- 기본 suite는 model download나 GPU를 요구하지 않는다.
- 실제 CUDA 완료 증거는 scripts smoke로 별도 확보한다.

## 검증

`uv run --frozen pytest -q -p no:cacheprovider`
