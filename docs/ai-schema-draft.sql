-- ═══════════════════════════════════════════════════════════════════════
-- DRAFT — ai 스키마 설계 스케치 (비확정 · 미적용)
-- ═══════════════════════════════════════════════════════════════════════
-- ⚠️ 이 파일은 "참고용 설계 초안"이지 마이그레이션이 아니다.
--    • ai 스키마는 Python/Alembic 소유 (ADR-0017 · 0006). 이 파일은 Flyway가 적용하지 않는다.
--    • 실제 테이블은 AI 플레인 착수(CP2/CP3) 시 AI 팀이 Alembic으로 확정·생성한다.
--    • 목적: BE가 그린 그림을 AI 팀에 출발점으로 전달(백지 방지). 컬럼·타입은 AI 팀이 조정.
--
-- 미확정(TBD):
--    • chunk_embedding.embedding 의 벡터 차원 = 임베딩 모델 확정 후 결정.
--      (pgvector 인덱스는 차원 고정 → 모델 바뀌면 컬럼·인덱스 재생성. 아래는 1536 예시)
--    • status/task_type 등 enum 값 집합, 청킹 전략, 잡 스키마 세부는 AI 파이프라인 확정 후.
--
-- 규약:
--    • 크로스플레인 참조(lesson_id·curriculum_id 등 core 대상)는 물리 FK 없이 논리 참조(_id). core를 Alembic이 못 건드리므로.
--    • ai 내부 참조(chunk_id·job_run_id·model_run_id)는 진짜 FK.
--    • PK: 고빈도 append(chunk/embedding)=bigint identity, 잡/실행 메타(job_run/model_run)=uuid.
--    • 시간=timestamptz, jsonb 기본값은 '[]'/'{}'.
-- ═══════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS vector;   -- pgvector (chunk_embedding용)
CREATE SCHEMA IF NOT EXISTS ai;

-- ── model_run: AI 모델 호출 1건의 원장(비용·계보·telemetry) ──
CREATE TABLE ai.model_run (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  task_type        varchar(100)  NOT NULL,            -- 예: 'embed','glossary_gen','answer'
  provider         varchar(100)  NOT NULL,            -- 예: 'openai','local'
  model_name       varchar(200)  NOT NULL,
  model_version    varchar(200)  NOT NULL,
  prompt_version   varchar(100)  NULL,
  parameters_json  jsonb         NOT NULL DEFAULT '{}',
  status           varchar(20)   NOT NULL DEFAULT 'RUNNING',  -- RUNNING/DONE/FAILED (TBD)
  input_hash       varchar(128)  NULL,                -- 동일 입력 캐시/중복탐지
  token_usage_json jsonb         NOT NULL DEFAULT '{}',
  estimated_cost   numeric(18,8) NULL,
  correlation_id   varchar(128)  NULL,                -- 요청 추적(React→Spring→AI)
  started_at       timestamptz   NOT NULL DEFAULT now(),
  ended_at         timestamptz   NULL,
  error_detail     text          NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

-- ── job_run: 비동기 잡 1건의 생명주기(워커 소유, Spring은 이력 읽기) ──
CREATE TABLE ai.job_run (
  id               uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id           varchar(255)  NOT NULL,
  idempotency_key  varchar(255)  NOT NULL UNIQUE,
  curriculum_id    uuid          NULL,        -- 논리 참조 core.curriculum (FK 없음)
  lesson_id        uuid          NULL,        -- 논리 참조 core.lesson (FK 없음)
  task_type        varchar(100)  NOT NULL,    -- 예: 'index_lesson'
  status           varchar(20)   NOT NULL DEFAULT 'QUEUED',  -- QUEUED/RUNNING/DONE/FAILED (TBD)
  input_refs       jsonb         NOT NULL DEFAULT '[]',
  output_refs      jsonb         NOT NULL DEFAULT '[]',
  policy_json      jsonb         NOT NULL DEFAULT '{}',
  contract_version varchar(50)   NOT NULL,
  attempt_count    integer       NOT NULL DEFAULT 0,
  correlation_id   varchar(128)  NULL,
  started_at       timestamptz   NULL,
  ended_at         timestamptz   NULL,
  error_detail     text          NULL,
  created_at       timestamptz   NOT NULL DEFAULT now(),
  updated_at       timestamptz   NOT NULL DEFAULT now()
);

-- ── document_chunk: RAG 코퍼스(자료·발화 청크). 검색의 대상 ──
CREATE TABLE ai.document_chunk (
  id            bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  lesson_id     uuid          NOT NULL,        -- 논리 참조 core.lesson (FK 없음)
  source_type   varchar(30)   NOT NULL,        -- 예: 'MATERIAL'(PPTX)/'TRANSCRIPT'(발화) (TBD)
  source_ref    varchar(500)  NOT NULL,        -- 원본 참조(material_asset id·slide 등)
  chunk_index   integer       NOT NULL,        -- 원본 내 순번
  text          text          NOT NULL,
  search_vector tsvector      NULL,            -- 키워드 검색(FTS) 보조
  start_ms      bigint        NULL,            -- 발화 청크면 세션 상대 시각
  end_ms        bigint        NULL,
  content_hash  varchar(128)  NOT NULL,        -- 재처리 중복 방지
  metadata_json jsonb         NOT NULL DEFAULT '{}',
  job_run_id    uuid          NULL REFERENCES ai.job_run(id),   -- 생성한 잡
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (lesson_id, source_ref, chunk_index)
);

-- ── chunk_embedding: 청크 임베딩 벡터(모델별) ──
CREATE TABLE ai.chunk_embedding (
  id            bigint        GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  chunk_id      bigint        NOT NULL REFERENCES ai.document_chunk(id) ON DELETE CASCADE,
  model_name    varchar(200)  NOT NULL,
  model_version varchar(200)  NOT NULL,
  dimensions    integer       NOT NULL,
  embedding     vector(1536)  NOT NULL,   -- ⚠️ TBD 차원: 임베딩 모델 확정 후(1536은 예시). 인덱스도 차원 고정.
  model_run_id  uuid          NULL REFERENCES ai.model_run(id),
  created_at    timestamptz   NOT NULL DEFAULT now(),
  updated_at    timestamptz   NOT NULL DEFAULT now(),
  UNIQUE (chunk_id, model_name, model_version)   -- 청크당 모델별 1벡터
);

-- 벡터 유사도 인덱스(차원 확정 후): HNSW cosine
-- CREATE INDEX ix_chunk_embedding_hnsw ON ai.chunk_embedding USING hnsw (embedding vector_cosine_ops);

-- 잡/실행 조회 인덱스(예시)
-- CREATE INDEX ix_job_run_lesson  ON ai.job_run (lesson_id, status);
-- CREATE INDEX ix_doc_chunk_lesson ON ai.document_chunk (lesson_id);
