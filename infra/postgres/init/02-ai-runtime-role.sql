-- ai-worker Alembic migration이 요구하는 최소 권한 group role.
-- 공식 Postgres image가 최초 DB를 만드는 시점에만 실행된다.
-- runtime login은 환경별로 따로 만들고 ai_app membership만 부여하는 것이 운영 원칙이다.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ai_app') THEN
    CREATE ROLE ai_app NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOREPLICATION NOBYPASSRLS;
  END IF;

  -- 로컬 compose의 DB owner가 SET LOCAL ROLE ai_app으로 migration 결과를 검증할 수 있게 한다.
  -- 운영에서는 별도 runtime login에 같은 membership을 명시적으로 부여한다.
  EXECUTE format('GRANT ai_app TO %I', current_user);
END
$$;
