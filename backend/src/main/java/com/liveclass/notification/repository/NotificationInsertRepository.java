package com.liveclass.notification.repository;

import com.liveclass.notification.api.NewNotification;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.stereotype.Repository;

import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 알림 삽입. <b>JPA가 아니라 네이티브</b>다 — {@code ON CONFLICT DO NOTHING}이 필요하기 때문이다.
 *
 * <p>"넣어 보고 중복 예외를 잡는" 방식은 못 쓴다. 실패한 statement가 트랜잭션을 <b>롤백 전용</b>으로
 * 만들어, 예외를 잡아도 커밋에서 다시 터진다(ADR-0064에서 실제로 겪었다). 처음부터 "있으면 넣지
 * 마라"라고 DB에 말해야 한다.
 *
 * <p>여러 건은 <b>한 문장</b>으로 넣는다. 행마다 왕복하면 팬아웃에서 그 비용이 그대로 곱해진다 —
 * 10만 행 기준 집합 삽입 828ms 대 행 단위 루프 1,521ms(네트워크 왕복조차 없는 조건)였다.
 */
@Repository
public class NotificationInsertRepository {

    private static final String INSERT = """
            INSERT INTO core.notification (
                id, recipient_id, type, read_status, action_status, severity,
                title, message, targets, group_key, dedupe_key,
                previous_starts_at, next_starts_at)
            VALUES (
                :id, :recipientId, :type, 'UNREAD', :actionStatus, :severity,
                :title, :message, CAST(:targets AS jsonb), :groupKey, :dedupeKey,
                :previousStartsAt, :nextStartsAt)
            ON CONFLICT (dedupe_key) DO NOTHING
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public NotificationInsertRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** @return 실제로 들어간 행 수. 중복이면 0이다(오류가 아니다). */
    public int insert(NewNotification notification) {
        return jdbc.update(INSERT, params(notification));
    }

    /** @return 실제로 들어간 행 수. 이미 있던 것은 세지 않는다. */
    public int insertAll(Collection<NewNotification> notifications) {
        if (notifications.isEmpty()) {
            return 0;
        }
        SqlParameterSource[] batch = notifications.stream()
                .map(NotificationInsertRepository::params)
                .toArray(SqlParameterSource[]::new);
        int inserted = 0;
        for (int affected : jdbc.batchUpdate(INSERT, batch)) {
            inserted += affected;
        }
        return inserted;
    }

    private static SqlParameterSource params(NewNotification n) {
        return new MapSqlParameterSource()
                .addValue("id", UUID.randomUUID())
                .addValue("recipientId", n.recipientId())
                .addValue("type", n.type())
                .addValue("actionStatus", n.actionStatus())
                .addValue("severity", n.severity())
                .addValue("title", n.title())
                .addValue("message", n.message())
                .addValue("targets", n.targetsJson())
                .addValue("groupKey", n.groupKey())
                .addValue("dedupeKey", n.dedupeKey())
                .addValue("previousStartsAt", n.previousStartsAt())
                .addValue("nextStartsAt", n.nextStartsAt());
    }

    /** 편의: 한 건짜리 목록. */
    public int insertAll(NewNotification... notifications) {
        return insertAll(List.of(notifications));
    }
}
