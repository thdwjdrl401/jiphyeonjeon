-- 알림의 content_id 외래 키를 뗀다(ADR-0129).
--
-- **왜.** 팬아웃 100만 건에서 이 확인 하나가 DB CPU의 20~23%를 쓴다(실측: 24.7초 → 19.0초).
-- 가리키는 core.notification_content에는 사건당 행이 하나뿐이고, 그 한 줄은 알림 행과 **같은
-- SQL 문장**에서 들어간다. 100만 행이 각자 그 한 줄이 있는지 확인하는 데 5.7초를 쓴다.
--
-- **끊긴 참조가 생길 경로가 지금은 없다.** 확인한 것:
--   · notification에 쓰는 곳은 셋뿐이고(NotificationFanoutRepository 둘, NotificationInsertRepository
--     하나) 전부 같은 문장의 CTE로 content를 함께 넣는다. JPA로 저장하는 경로는 없다.
--   · content를 지우는 코드가 없다. 보존 정리는 notification 파티션 DROP이고 정규식이
--     '^notification_p[0-9]{4}_[0-9]{2}$'만 고른다 — content는 알림보다 오래 산다.
--   · content_id NOT NULL은 이 제약과 별개라 그대로 남는다.
--
-- **무엇을 잃나.** 앞으로 content 없이 알림을 넣는 코드가 생기면, 지금은 그 자리에서 실패하지만
-- 이제는 그 알림이 사용자 목록에서 조용히 사라진다 — 목록 질의가 content와 inner join이라
-- (JOIN FETCH n.content) 없는 행은 예외가 아니라 실종이 된다.
--
-- **되돌리기는 350ms다**(100만 행 실측). 끊긴 참조가 실제로 생기면 그때 다시 걸면 된다.
-- 파티션 테이블이라 NOT VALID를 못 쓰지만, 통짜가 350ms라 나눌 이유가 없다.
--
--     ALTER TABLE core.notification ADD CONSTRAINT notification_partitioned_content_id_fkey
--         FOREIGN KEY (content_id) REFERENCES core.notification_content(id);

ALTER TABLE core.notification
    DROP CONSTRAINT IF EXISTS notification_partitioned_content_id_fkey;
