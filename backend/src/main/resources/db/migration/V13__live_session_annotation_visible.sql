-- 판서 표시 상태(켜짐/꺼짐)를 세션에 남긴다(ADR-0056).
--
-- 판서 요소는 core.live_annotation_op에 있지만 "그것을 지금 보여주는가"는 문서 내용이 아니라
-- 세션의 표시 상태다. 그래서 문서가 아니라 여기 둔다.
--
-- 이 값이 없으면 강사가 새로고침할 때마다 판서가 꺼진 채로 시작하는데, Egress는 자기 문서를
-- 계속 들고 있어 <b>수강생에게만 판서가 남는다</b> — 강사 화면에서는 정상으로 보이므로 알아챌 수
-- 없다. 그 어긋남을 막는 것이 이 컬럼의 존재 이유다.
--
-- 기본값 false: 새로 만든 세션은 판서가 꺼진 채로 시작한다(지금 동작과 같다).
alter table core.live_session
  add column annotation_visible boolean not null default false;

comment on column core.live_session.annotation_visible is
  '판서를 수강생 화면에 표시 중인가(ADR-0056). 문서 내용이 아니라 표시 상태다.';
