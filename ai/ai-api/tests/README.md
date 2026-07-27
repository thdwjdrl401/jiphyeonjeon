# `ai-api/tests`

`ai-api` 실행 골격과 RAG request→SSE terminal 수직 계약을 검증한다.

## 역할

- 필수 설정과 port/log-level 제약을 검증한다.
- health와 readiness가 lifespan을 따르는지 검증한다.
- JSON 로그에 공통 context만 포함되고 secret이 노출되지 않는지 확인한다.
- RAG DTO의 camelCase·범위·추가 필드 거부 규칙을 검증한다.
- 근거 부족, citation 중복 제거, scope 유출 차단, timeout·실패 정제와 취소 전파를 검증한다.
- 내부 endpoint의 인증·Accept·body 상태코드와 SSE framing을 검증한다.

## 구조와 흐름

외부 서비스 없이 FastAPI test client와 fake 인증·retrieval·model port로 실행한다. 따라서 이 테스트는
실제 Redis, PostgreSQL, BGE, GMS 또는 Spring JWT 연동 완료를 뜻하지 않는다.

## 파일 구성

| 파일 | 책임 |
|---|---|
| `test_config.py` | `AI_API_*` 설정 |
| `test_lifecycle.py` | `/healthz`, `/readyz` |
| `test_logging.py` | 구조화 로그와 민감정보 제외 |
| `test_rag_streaming.py` | RAG 모델 계약·오케스트레이션·timeout·취소·SSE 인코딩 |
| `test_rag_endpoint.py` | 내부 인증/상태코드와 end-to-end SSE 계약 |

## 경계와 불변식

- RAG 계약은 [`../CONTRACT.md`](../CONTRACT.md)의 AI-side 후보만 검증한다.
- Java가 채택할 때 공유 `docs/CONTRACT.md`와 Spring 계약 테스트를 같은 common MR에서 갱신한다.
- skip으로 외부 dependency 부재를 숨기지 않는다. 실제 adapter 도입 MR에서 격리 인프라 테스트를 추가한다.

## 검증

```bash
cd ai/ai-api
uv run --frozen pytest -q -p no:cacheprovider
```
