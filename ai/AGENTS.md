# AGENTS.md — AI 서비스 보충 규칙

이 디렉터리에서는 루트 [`AGENTS.md`](../AGENTS.md)를 먼저 따른다.

- Python 버전은 3.12로 고정한다.
- 각 서비스는 자체 `pyproject.toml`과 `uv.lock`을 소유한다.
- 의존성 설치와 실행에는 `uv`를 사용하며, 구체적인 명령은 각 서비스 README를 따른다.
- 변경한 서비스에서 `uv run --frozen pytest -q -p no:cacheprovider`와
  `uv run --frozen ruff check app tests`를 실행한다.
- API payload, 메시지 payload, 상태코드처럼 Java와 공유하는 계약을 바꾸면
  `docs/CONTRACT.md`와 양쪽 계약 테스트를 같은 MR에서 갱신한다.
- 로그의 message, event, exception, context에는 토큰·비밀번호·API key를 넣지 않는다.
