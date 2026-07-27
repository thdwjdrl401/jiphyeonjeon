# `ai-api/tests`

현재 `ai-api` 실행 골격의 설정·생명주기·로그 계약을 검증한다.

## 역할

- 필수 설정과 port/log-level 제약을 검증한다.
- health와 readiness가 lifespan을 따르는지 검증한다.
- JSON 로그에 공통 context만 포함되고 secret이 노출되지 않는지 확인한다.

## 구조와 흐름

외부 서비스 없이 FastAPI test client와 직접 모델 호출로 실행한다.

## 파일 구성

| 파일 | 책임 |
|---|---|
| `test_config.py` | `AI_API_*` 설정 |
| `test_lifecycle.py` | `/healthz`, `/readyz` |
| `test_logging.py` | 구조화 로그와 민감정보 제외 |

## 경계와 불변식

- 아직 존재하지 않는 RAG/SSE 계약을 테스트가 있다고 표현하지 않는다.
- 업무 API 추가 시 공유 계약과 상태코드 테스트를 함께 추가한다.

## 검증

```bash
cd ai/ai-api
uv run --frozen pytest -q -p no:cacheprovider
```
