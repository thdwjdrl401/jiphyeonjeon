-- 공개 카탈로그와 강사 운영 목록의 이름순은 같은 curriculum.title을 정렬한다.
--
-- DB 기본 en_US.utf8에 맡기면 한글이 유니코드 가나다순으로 정렬되지 않는다. 프론트 Mock은
-- Intl/localeCompare의 ko 규칙을 써서 실제 PostgreSQL과 결과도 갈렸다. DB 전체 locale을 바꾸면
-- 이메일·파일명·기술 식별자까지 영향을 받으므로, 사용자에게 이름순으로 노출하는 제목 컬럼에만
-- 프로젝트 소유 ICU 콜레이션을 적용한다.
CREATE COLLATION core.ko_kr (
    provider = icu,
    locale = 'ko-KR',
    deterministic = true
);

ALTER TABLE core.curriculum
    ALTER COLUMN title TYPE varchar(200) COLLATE core.ko_kr;

-- lifecycle_status로 공개 행을 좁힌 뒤 제목과 동률 해소 키(id) 순으로 바로 읽는다.
-- 기존 ix_curriculum_catalog(lifecycle_status, published_at DESC)는 최신순을 계속 담당한다.
CREATE INDEX ix_curriculum_catalog_title
    ON core.curriculum (lifecycle_status, title, id);

COMMENT ON COLUMN core.curriculum.title IS
    '커리큘럼 제목. 이름순은 core.ko_kr(ko-KR ICU)로 정렬하며 한글·영문 제목을 모두 허용한다.';
