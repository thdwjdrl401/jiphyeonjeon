-- 강의 자료 임베딩 상태(ADR-0036). 연결 상태(status: ACTIVE/DELETED)와 직교하는 파이프라인 상태.
-- PENDING(잡 대기) → PROCESSING(AI 처리 중) → READY(pgvector 적재 완료) / FAILED.
-- 기존 행은 파이프라인 이전에 붙은 자료라 READY로 승계(로딩 표시 방지). 신규 연결은 애플리케이션이 설정.
ALTER TABLE core.material_asset
  ADD COLUMN embedding_status varchar(20) NOT NULL DEFAULT 'READY'
    CHECK (embedding_status IN ('PENDING','PROCESSING','READY','FAILED'));

COMMENT ON COLUMN core.material_asset.embedding_status IS
  '자료 임베딩 파이프라인 상태(ADR-0036). PENDING→PROCESSING→READY/FAILED. 연결 상태(status)와 별개.';
