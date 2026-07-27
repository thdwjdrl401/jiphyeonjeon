# `ai-worker/migrations`

Python 소유 PostgreSQL `ai` schema의 Alembic 환경이다.

## 역할

- 별도 sync migration DSN을 검증한다.
- online/offline migration과 least-privilege role 검사를 수행한다.

## 구조와 흐름

`alembic.ini -> env.py -> versions/*.py -> PostgreSQL` 순서다.

## 파일 구성

`env.py`, `script.py.mako`, [`versions/`](versions/README.md)로 구성된다.

## 경계와 불변식

- `ai_app`은 사전 생성된 안전한 NOLOGIN role이어야 한다.
- Spring 소유 `core` schema ACL이나 객체를 변경하지 않는다.
- migration 계정과 runtime login을 분리한다.

## 검증

상위 README의 Alembic 명령과 storage migration 테스트를 따른다.
