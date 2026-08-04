-- PPTX 핵심 용어 추출 상태(ADR-0010). 임베딩 성공 여부와 직교한다.
-- 최신 master의 V30과 녹화강의 기반 V31 다음에 적용한다.
-- 기존 자료는 용어 추출 요청 여부를 알 수 없으므로 NOT_REQUESTED로 승계한다.
ALTER TABLE core.material_asset
  ADD COLUMN key_term_status varchar(20) NOT NULL DEFAULT 'NOT_REQUESTED'
    CHECK (key_term_status IN (
      'NOT_REQUESTED','PENDING','PROCESSING','READY','EMPTY','FAILED'
    ));

COMMENT ON COLUMN core.material_asset.key_term_status IS
  'PPTX 핵심 용어 추출 상태(ADR-0010). NOT_REQUESTED/PENDING/PROCESSING/READY/EMPTY/FAILED.';
