-- 판서 복원 체크포인트(ADR-0057).
--
-- 복원은 "마지막 스냅샷 + 그 이후 op"를 접는데, ADR-0055 이후 스냅샷이 저장되지 않아 세션 시작부터
-- 전부 내려오고 있었다(실측 983kB / op 233건 / 스냅샷 0건). 강의가 길어질수록 무한히 자란다.
--
-- op 테이블에 넣지 않는 이유는 revision이다. 이미 쓴 번호는 (session_id, revision) UNIQUE에 걸리고,
-- 새 번호를 소비하면 그 번호가 데이터 채널로 나가지 않아 수신 측에서 번호 구멍이 된다 — 수신 측은
-- revision이 이어지지 않으면 그 뒤 op를 전부 버린다. ADR-0055 이후 스냅샷은 전송 메시지가 아니므로
-- op 스트림 밖에 두는 것이 맞다.
--
-- 세션당 한 행이다. 과거 체크포인트를 남길 이유가 없다 — 복원은 언제나 가장 최근 것에서 시작한다.
create table core.live_annotation_snapshot (
  session_id  uuid        primary key references core.live_session (id) on delete cascade,
  revision    bigint      not null,
  payload     jsonb       not null,
  updated_at  timestamptz not null default now()
);

comment on table core.live_annotation_snapshot is
  '판서 복원 체크포인트(ADR-0057). 세션당 한 행이며 새 것이 오면 덮어쓴다.';
comment on column core.live_annotation_snapshot.revision is
  '이 체크포인트가 반영한 마지막 op 번호. 복원은 이보다 큰 op만 얹는다.';
