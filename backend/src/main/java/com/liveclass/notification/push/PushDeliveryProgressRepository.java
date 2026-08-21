package com.liveclass.notification.push;

import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.UUID;

/**
 * 푸시 발송 진행 표(ADR-0124). "이 사건의 이 사람에 대한 발송 시도를 마쳤다"를 적고 되묻는다.
 *
 * <p>이 표가 있어야 푸시 명령의 재배달이 안전해진다 — 명령의 재시도 단위는 메시지(조각)인데 실패
 * 단위는 사람이라, 재배달에서 <b>이미 시도를 마친 사람을 빼는</b> 장치가 없으면 조각 전원이 다시
 * 울리거나(전부 재발송) 전원이 못 받는다(전부 건너뜀).
 *
 * <p>표는 UNLOGGED·일 파티션이다(V46). 크래시로 사라지면 배달 중이던 방송이 처음부터 다시 나갈
 * 뿐이고, 그 선택의 이유는 V46 주석과 ADR-0124에 있다.
 */
@Repository
public class PushDeliveryProgressRepository {

    /*
     * anti-join을 SQL 한 문장(NOT EXISTS)으로 하지 않고 "기록된 쪽"을 조회해 자바에서 뺀다.
     * 명단이 이미 앱 메모리에 있으므로(명령이 싣고 왔다) 배열을 DB에 넣어 되받을 이유가 없다.
     *
     * <b>명단은 IN 목록이 아니라 배열로 넘긴다.</b> IN이면 파라미터가 명단 크기만큼 생겨
     * (조각 5,000명이면 5,001개) 크기마다 다른 문장이 되고, 계획 캐시가 그만큼 쪼개진다 —
     * 같은 이유로 markDelivered는 pg_stat_statements에 105종으로 흩어져 있었다.
     * 배열이면 문장이 하나로 고정되고 파티션 로컬 인덱스도 그대로 탄다.
     */
    private static final String SETTLED = """
            SELECT recipient_id
            FROM core.notification_push_progress
            WHERE event_hash = ? AND recipient_id = ANY(?)
            """;

    /*
     * ON CONFLICT DO NOTHING — 재배달과 크래시 재시도가 같은 (사건, 사람)을 다시 적을 수 있다.
     * 대상 제약을 명시하지 않는 이유는 유니크가 파티션 지역이라 부모에 이름 붙은 제약이 없어서다.
     *
     * <b>명단을 배열로 넘겨 한 문장에 여러 사람을 적는다.</b> 사람마다 문장 하나였을 때는 100만
     * 명이면 문장도 100만 개였다 — 건당 0.01ms인데 횟수가 그만큼이라 10.5초였다(ADR-0137).
     */
    private static final String SETTLE = """
            INSERT INTO core.notification_push_progress (event_hash, recipient_id)
            SELECT CAST(? AS uuid), r
              FROM unnest(CAST(? AS uuid[])) AS r
            ON CONFLICT DO NOTHING
            """;

    /**
     * 한 문장에 적는 사람 수.
     *
     * <p><b>조각 전체를 한 문장으로 하지 않는 이유는 실패 의미론을 그대로 두기 위해서다.</b>
     * 한 문장이면 전부 아니면 전무가 된다 — 발송을 마치고 기록하는 도중에 죽으면 하나도 안 남고,
     * 재배달이 그 조각 전원(5,000명대)에게 다시 보낸다. 지금은 앞쪽이 남아 있어 안 남은 사람만
     * 다시 간다. 성능만 바꾸려던 변경이 동작까지 바꾸면 안 된다.
     *
     * <p>이 크기면 조각당 문장이 대여섯 개다. 100만 개에서 1,200개대로 줄면서 크래시 때 다시 갈
     * 사람 수는 지금과 같은 자리에 남는다.
     */
    private static final int SETTLE_CHUNK = 1_000;

    private final NamedParameterJdbcTemplate jdbc;

    public PushDeliveryProgressRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * 이 사건에서 <b>아직 발송 시도를 마치지 않은</b> 사람들. 입력 순서를 지켜 돌려준다.
     *
     * <p>파티션 지역 유니크라 날짜를 넘긴 중복 행이 이론상 가능하지만, 여기서는 "있는가"만 보므로
     * 중복이 답을 바꾸지 않는다(V46 주석).
     */
    public List<UUID> remaining(UUID eventHash, List<UUID> recipientIds) {
        if (recipientIds.isEmpty()) {
            return List.of();
        }
        Set<UUID> settled = Set.copyOf(jdbc.getJdbcTemplate().query(SETTLED,
                ps -> {
                    ps.setObject(1, eventHash);
                    ps.setArray(2, ps.getConnection()
                            .createArrayOf("uuid", recipientIds.toArray()));
                },
                (rs, rowNum) -> rs.getObject(1, UUID.class)));
        if (settled.isEmpty()) {
            return recipientIds;
        }
        return recipientIds.stream().filter(id -> !settled.contains(id)).toList();
    }

    /**
     * 발송 시도를 마친 사람들을 기록한다. <b>큐에 넣은 시각이 아니라 시도를 마친 뒤</b>에 불러야
     * 한다 — 미리 적으면 발송 전에 죽었을 때 그 사람들이 영영 빠진다.
     */
    public void settle(UUID eventHash, Collection<UUID> recipientIds) {
        if (recipientIds.isEmpty()) {
            return;
        }
        List<UUID> all = List.copyOf(recipientIds);
        for (int from = 0; from < all.size(); from += SETTLE_CHUNK) {
            List<UUID> chunk = all.subList(from, Math.min(from + SETTLE_CHUNK, all.size()));
            jdbc.getJdbcTemplate().update(SETTLE, ps -> {
                ps.setObject(1, eventHash);
                ps.setArray(2, ps.getConnection().createArrayOf("uuid", chunk.toArray()));
            });
        }
    }
}
