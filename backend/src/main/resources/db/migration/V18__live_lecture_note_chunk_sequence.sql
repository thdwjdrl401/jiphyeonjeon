-- 강의 노트 조각 순번(CONTRACT §3-4a). 갭 판정에 필요하다.
--
-- covered_through_sequence(자막 진행도)와 다른 축이다. 자막 진행도는 "어디까지 들었나"이고 이건
-- "몇 번째 조각까지 반영했나"다. 계약이 요구하는 "기대값보다 큰 chunkSequence는 반영하지 않고
-- pending에 남긴다"를 판정하려면 마지막으로 반영한 조각 번호를 알아야 한다.
--
-- capture.completed도 이 값으로 검증한다 — lastChunkSequence가 지금 반영한 순번과 같을 때만
-- 수집 완료로 본다(중간이 빠진 채 완료로 확정하지 않는다).
ALTER TABLE core.live_lecture_note
  ADD COLUMN last_chunk_sequence bigint NOT NULL DEFAULT 0;

COMMENT ON COLUMN core.live_lecture_note.last_chunk_sequence IS
  '마지막으로 반영한 조각 번호. 갭 판정과 capture.completed 검증에 쓴다(자막 진행도와 다른 축).';
