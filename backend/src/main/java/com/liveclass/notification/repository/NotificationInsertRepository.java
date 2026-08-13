package com.liveclass.notification.repository;

import com.liveclass.notification.api.NewNotification;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.jdbc.core.namedparam.SqlParameterSource;
import org.springframework.stereotype.Repository;

import java.nio.charset.StandardCharsets;
import java.util.Collection;
import java.util.List;
import java.util.UUID;

/**
 * 알림 삽입(좁은 팬아웃). <b>JPA가 아니라 네이티브</b>다 — {@code ON CONFLICT DO NOTHING}이 필요하기
 * 때문이다.
 *
 * <p>"넣어 보고 중복 예외를 잡는" 방식은 못 쓴다. 실패한 statement가 트랜잭션을 <b>롤백 전용</b>으로
 * 만들어, 예외를 잡아도 커밋에서 다시 터진다(ADR-0064에서 실제로 겪었다). 처음부터 "있으면 넣지
 * 마라"라고 DB에 말해야 한다.
 *
 * <p><b>중복 판정은 본체가 아니라 전역 등록표가 한다</b>(ADR-0123). 본체는 월 파티션이라 파티션 키
 * 없는 전역 유니크를 걸 수 없는데, dedupe는 월을 넘어야 한다(재공개가 다시 알리지 않음). 그래서
 * 한 문장 CTE가 등록표 통과 → 문구(content) 확보 → 본체 삽입을 같은 트랜잭션에서 잇는다.
 *
 * <p>여러 건은 <b>한 문장</b>으로 넣는다. 행마다 왕복하면 팬아웃에서 그 비용이 그대로 곱해진다 —
 * 10만 행 기준 집합 삽입 828ms 대 행 단위 루프 1,521ms(네트워크 왕복조차 없는 조건)였다.
 */
@Repository
public class NotificationInsertRepository {

    /*
     * 세 단계가 전부 gate에 걸려 있다. 등록표 삽입이 충돌하면(이미 본 사건) gate가 비고,
     * content도 본체도 0행이다 — 반환값(본체 삽입 수)이 그대로 "실제로 들어갔는가"가 된다.
     *
     * content 삽입에도 ON CONFLICT를 거는 이유: content id는 dedupe_key에서 결정적으로 파생하므로
     * 등록표가 초기화되는 일 없이 겹칠 수는 없지만, 만에 하나 겹쳐도 문구 한 벌이 재사용될 뿐
     * 삽입이 죽지 않아야 한다. 본체 삽입은 CTE의 RETURNING이 아니라 파라미터의 content id를 그대로
     * 쓴다 — DO NOTHING이면 RETURNING이 비기 때문이다. FK 검증은 문장 끝에 몰아서 돌아 같은 문장
     * 안에서 만든 content 행도 보인다.
     */
    private static final String INSERT = """
            WITH gate AS (
                INSERT INTO core.notification_dedupe (dedupe_hash)
                VALUES (md5(:dedupeKey)::uuid)
                ON CONFLICT (dedupe_hash) DO NOTHING
                RETURNING dedupe_hash
            ), content AS (
                INSERT INTO core.notification_content (
                    id, type, severity, title, message, targets, group_key,
                    previous_starts_at, next_starts_at)
                SELECT CAST(:contentId AS uuid), :type, :severity, :title, :message,
                       CAST(:targets AS jsonb), :groupKey,
                       CAST(:previousStartsAt AS timestamptz), CAST(:nextStartsAt AS timestamptz)
                FROM gate
                ON CONFLICT (id) DO NOTHING
            )
            INSERT INTO core.notification (id, recipient_id, content_id, read_status, action_status)
            SELECT :id, :recipientId, CAST(:contentId AS uuid), 'UNREAD', :actionStatus
            FROM gate
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
                .addValue("contentId", contentIdOf(n.dedupeKey()).toString())
                .addValue("type", n.type())
                .addValue("actionStatus", n.actionStatus())
                .addValue("severity", n.severity())
                .addValue("title", n.title())
                .addValue("message", n.message())
                .addValue("targets", n.targetsJson())
                .addValue("groupKey", n.groupKey())
                .addValue("dedupeKey", n.dedupeKey())
                /*
                 * 문자열로 넘기고 SQL에서 캐스팅한다 — VALUES가 아니라 SELECT 안이라, null일 때
                 * JDBC가 타입을 못 정해 "could not determine data type"으로 터질 수 있다
                 * (NotificationFanoutRepository와 같은 이유·같은 방식).
                 */
                .addValue("previousStartsAt",
                        n.previousStartsAt() == null ? null : n.previousStartsAt().toString())
                .addValue("nextStartsAt",
                        n.nextStartsAt() == null ? null : n.nextStartsAt().toString());
    }

    /**
     * 문구 행의 <b>결정적</b> id. 같은 사건(dedupe_key가 같다)이 재배달로 두 번 오면 같은 id가
     * 나와 content가 한 벌로 접힌다 — id를 난수로 뽑으면 재배달마다 고아 content가 하나씩 남는다.
     * 좁은 팬아웃은 문구에 사람 이름이 들어갈 수 있어 content가 수신자당 1행이 되는데, dedupe_key에
     * 수신자가 이미 들어 있으므로 이 파생이 그 구분까지 함께 해결한다.
     */
    static UUID contentIdOf(String dedupeKey) {
        return UUID.nameUUIDFromBytes(("notification-content:" + dedupeKey)
                .getBytes(StandardCharsets.UTF_8));
    }

    /** 편의: 한 건짜리 목록. */
    public int insertAll(NewNotification... notifications) {
        return insertAll(List.of(notifications));
    }
}
