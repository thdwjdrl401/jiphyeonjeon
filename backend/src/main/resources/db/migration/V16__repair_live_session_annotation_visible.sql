-- 공유 dev DB에서 과거 기능 브랜치의 V13__remove_video_asset_requested_status.sql이
-- master의 V13__live_session_annotation_visible.sql보다 먼저 적용된 적이 있다.
-- Flyway repair는 schema history의 설명과 checksum만 현재 파일에 맞추며 SQL을 다시 실행하지 않으므로,
-- 이 DB에는 V13이 성공으로 기록됐지만 실제 annotation_visible 컬럼은 없는 상태가 남았다.
--
-- 새 DB는 V13에서 이미 컬럼을 만들기 때문에 여기서는 no-op이다. 기존 공유 DB에는 누락 컬럼을 만들고,
-- 혹시 부분 적용으로 nullable 컬럼이 남은 경우까지 master의 NOT NULL DEFAULT false 계약으로 수렴시킨다.
alter table core.live_session
  add column if not exists annotation_visible boolean;

update core.live_session
set annotation_visible = false
where annotation_visible is null;

alter table core.live_session
  alter column annotation_visible set default false,
  alter column annotation_visible set not null;

comment on column core.live_session.annotation_visible is
  '판서를 수강생 화면에 표시 중인가(ADR-0056). 문서 내용이 아니라 표시 상태다.';
