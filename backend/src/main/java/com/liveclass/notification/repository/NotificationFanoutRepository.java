package com.liveclass.notification.repository;

import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 넓은 팬아웃의 삽입. <b>수신자 명단이 앱을 통과하지 않는다</b>(ADR-0073 §5).
 *
 * <p>명단을 조회해 와서 행마다 넣으면 수신자 수만큼 왕복이 생긴다. 여기서는 조건과 커서를 SQL에
 * 주고 <b>한 문장</b>으로 끝낸다 — 10만 행 기준 집합 삽입 828ms, 같은 결과를 DB 안 루프로 만들면
 * 1,521ms였다(네트워크 왕복조차 없는 최선의 조건이 그렇다).
 *
 * <p><b>조건은 SQL이 걸고 커서는 그 집합 안에서의 위치다.</b> 메시지가 조건문을 실어 나르면 주입
 * 표면이 생기고, 조건을 고쳤을 때 큐에 떠 있는 옛 메시지가 옛 조건으로 돈다.
 */
@Repository
public class NotificationFanoutRepository {

    /**
     * 한 조각.
     *
     * <p>세 값이 각각 필요하다. {@code inserted}는 <b>실제로 새로 생긴 알림 수</b>(중복은 빠진다),
     * {@code scanned}는 <b>이번 조각이 훑은 수강생 수</b>, {@code lastUserId}는 <b>다음 조각의 시작점</b>이다.
     *
     * <p>{@code inserted}로 다음을 판단하면 안 된다 — 재시도로 전부 중복이면 0이 나오지만 뒤에
     * 수강생이 남아 있을 수 있고, 그러면 거기서 체인이 끊긴다. 더 있는지는 {@code scanned}가 답한다.
     */
    public record Slice(int scanned, int inserted, UUID lastUserId) {

        /** 조각이 가득 찼으면 뒤가 더 있을 수 있다. 몇 조각인지 미리 세지 않는다 — COUNT(*)를 피한다. */
        public boolean mayHaveMore(int limit) {
            return scanned >= limit && lastUserId != null;
        }
    }

    /*
     * 데이터 변경 CTE 하나로 끝낸다.
     *
     * slice를 먼저 고정해 두는 것이 요점이다. INSERT ... RETURNING만으로는 커서를 얻을 수 없다 —
     * ON CONFLICT DO NOTHING이 중복을 건너뛰므로, 조각의 마지막 몇 명이 이미 받은 사람이면
     * RETURNING에 그들이 없고 커서가 뒤로 밀린다. 그러면 그 자리부터 영영 다시 훑는다.
     *
     * dedupe_key는 행마다 달라야 하므로(수신자가 다르다) SQL에서 이어 붙인다.
     */
    private static final String INSERT_SLICE = """
            WITH slice AS (
                SELECT e.user_id
                FROM core.enrollment e
                WHERE e.curriculum_id = CAST(:curriculumId AS uuid)
                  AND e.status = 'ACTIVE'
                  AND (CAST(:afterUserId AS uuid) IS NULL OR e.user_id > CAST(:afterUserId AS uuid))
                ORDER BY e.user_id
                LIMIT :sliceLimit
            ), inserted AS (
                INSERT INTO core.notification (
                    id, recipient_id, type, read_status, action_status, severity,
                    title, message, targets, group_key, dedupe_key,
                    previous_starts_at, next_starts_at)
                SELECT gen_random_uuid(), s.user_id, :type, 'UNREAD', :actionStatus, :severity,
                       :title, :message, CAST(:targets AS jsonb), :groupKey,
                       :dedupePrefix || s.user_id,
                       CAST(:previousStartsAt AS timestamptz), CAST(:nextStartsAt AS timestamptz)
                FROM slice s
                ON CONFLICT (dedupe_key) DO NOTHING
                RETURNING 1
            )
            SELECT (SELECT count(*) FROM slice)    AS scanned,
                   (SELECT count(*) FROM inserted) AS inserted,
                   -- max(uuid) 집계는 Postgres에 없다. 조각이 이미 user_id 오름차순이므로
                   -- 내림차순 첫 행이 곧 마지막 사람이고, 그게 다음 조각의 시작점이다.
                   (SELECT s.user_id FROM slice s ORDER BY s.user_id DESC LIMIT 1) AS last_user_id
            """;

    private final NamedParameterJdbcTemplate jdbc;

    public NotificationFanoutRepository(NamedParameterJdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * 커리큘럼의 <b>수강 중(ACTIVE)</b> 학생에게 알림 한 조각을 넣는다.
     *
     * @param afterUserId 커서. {@code null}이면 처음부터.
     * @param dedupePrefix 수신자 id를 이어 붙이기 <b>전까지</b>의 중복 제거 키. 뒤에 user_id가 붙는다.
     * @param previousStartsAt 일정 변경 알림에만 값이 있다. 나머지는 {@code null}.
     */
    public Slice insertForActiveStudents(UUID curriculumId, UUID afterUserId, int sliceLimit,
                                         String type, String actionStatus, String severity,
                                         String title, String message, String targetsJson,
                                         String groupKey, String dedupePrefix,
                                         OffsetDateTime previousStartsAt, OffsetDateTime nextStartsAt) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("curriculumId", curriculumId.toString())
                .addValue("afterUserId", afterUserId == null ? null : afterUserId.toString())
                .addValue("sliceLimit", sliceLimit)
                .addValue("type", type)
                .addValue("actionStatus", actionStatus)
                .addValue("severity", severity)
                .addValue("title", title)
                .addValue("message", message)
                .addValue("targets", targetsJson)
                .addValue("groupKey", groupKey)
                .addValue("dedupePrefix", dedupePrefix)
                /*
                 * 일정 변경 알림의 "언제에서 언제로". 문자열로 넘기고 SQL에서 캐스팅한다 —
                 * null일 때 JDBC가 타입을 못 정해 "could not determine data type"으로 터지기 때문이다.
                 */
                .addValue("previousStartsAt", previousStartsAt == null ? null : previousStartsAt.toString())
                .addValue("nextStartsAt", nextStartsAt == null ? null : nextStartsAt.toString());
        return jdbc.queryForObject(INSERT_SLICE, params, (rs, i) -> new Slice(
                rs.getInt("scanned"), rs.getInt("inserted"), rs.getObject("last_user_id", UUID.class)));
    }
}
