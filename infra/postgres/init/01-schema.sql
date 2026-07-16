-- T0 최소 부트스트랩: pgvector 확장 + core/ai 스키마 분리 (ADR-0005·0006)
-- 이 스크립트는 데이터 볼륨이 비어있는 "최초 기동" 1회만 실행된다.
-- 테이블은 마이그레이션이 생성한다: Flyway(core, Spring) / Alembic(ai, Python).

CREATE EXTENSION IF NOT EXISTS vector;

CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS ai;

COMMENT ON SCHEMA core IS 'Spring 단독 쓰기 — 공식 read model (ADR-0006)';
COMMENT ON SCHEMA ai   IS 'Python 단독 쓰기 — 후보/원본 (ADR-0006)';

-- 서비스별 least-privilege 롤(core_app=Spring / ai_app=Python)은
-- 마이그레이션 도입(CP0/CP2) 시 추가한다. 스키마 공동수정 금지가 계약이므로
-- 최종적으로 core_app은 core만, ai_app은 ai만 쓰기 권한을 갖는다.
