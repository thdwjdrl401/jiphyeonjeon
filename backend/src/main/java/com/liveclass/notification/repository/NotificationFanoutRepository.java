package com.liveclass.notification.repository;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;
import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;
import org.springframework.stereotype.Repository;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
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
 *
 * <p>ADR-0123 이후 문구는 사건당 한 행(content)이고 중복 판정은 전역 등록표가 한다. 둘 다 같은
 * 한 문장 CTE 안에 있다 — 트랜잭션이 갈라지면 "등록은 됐는데 행이 없는" 사건이 생길 수 있다.
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
    public record Slice(int scanned, int inserted, List<UUID> insertedRecipients, UUID lastUserId) {

        /** 조각이 가득 찼으면 뒤가 더 있을 수 있다. 몇 조각인지 미리 세지 않는다 — COUNT(*)를 피한다. */
        public boolean mayHaveMore(int limit) {
            return scanned >= limit && lastUserId != null;
        }
    }

    /*
     * 데이터 변경 CTE 하나로 끝낸다.
     *
     * slice를 먼저 고정해 두는 것이 요점이다. INSERT ... RETURNING만으로는 커서를 얻을 수 없다 —
     * 중복 제거가 이미 받은 사람을 건너뛰므로, 조각의 마지막 몇 명이 이미 받은 사람이면
     * RETURNING에 그들이 없고 커서가 뒤로 밀린다. 그러면 그 자리부터 영영 다시 훑는다.
     * 커서(last_user_id)와 훑은 수(scanned)는 그래서 언제나 slice에서 나온다 — 등록표가 얼마나
     * 걸러내든 체인은 이어진다.
     *
     * 중복 판정은 알림 표의 dedupe_hash 유니크가 한다(ADR-0132). 파티션을 쓰던 동안에는
     * 전역 유니크를 걸 수 없어 별도 등록표가 그 일을 맡았고, 파티션을 걷으면서 되돌렸다.
     * ON CONFLICT DO NOTHING이 통과 여부를 정하고, RETURNING이 새로 받은 사람만 돌려준다.
     */
    private static final String INSERT_SLICE = """
            WITH slice AS (
                SELECT e.user_id
                FROM core.enrollment e
                WHERE e.curriculum_id = CAST(:curriculumId AS uuid)
                  AND e.status = 'ACTIVE'
                  AND (CAST(:afterUserId AS uuid) IS NULL OR e.user_id > CAST(:afterUserId AS uuid))
                  -- 이 체인이 맡은 구간의 상한. null이면 끝까지(병렬화 이전과 같다).
                  AND (CAST(:untilUserId AS uuid) IS NULL OR e.user_id <= CAST(:untilUserId AS uuid))
                ORDER BY e.user_id
                LIMIT :sliceLimit
            ), content AS (
                INSERT INTO core.notification_content (
                    id, type, severity, title, message, targets, group_key,
                    previous_starts_at, next_starts_at)
                SELECT CAST(:contentId AS uuid), :type, :severity, :title, :message,
                       CAST(:targets AS jsonb), :groupKey,
                       CAST(:previousStartsAt AS timestamptz), CAST(:nextStartsAt AS timestamptz)
                WHERE EXISTS (SELECT 1 FROM slice)
                ON CONFLICT (id) DO NOTHING
            ), inserted AS (
                /*
                 * 중복 방지가 이 삽입 안에서 끝난다(ADR-0132). 파티션을 걷어 알림 표에 전역
                 * 유니크를 걸 수 있게 되면서, 등록표에 먼저 넣고 통과분을 조인하던 두 단계가
                 * 한 단계가 됐다 — 알림 1건에 힙 2행·인덱스 4벌이 들던 것이 1행·3벌이다.
                 */
                INSERT INTO core.notification
                        (id, recipient_id, content_id, dedupe_hash, read_status, action_status)
                SELECT gen_random_uuid(), s.user_id, CAST(:contentId AS uuid),
                       md5(:dedupePrefix || s.user_id)::uuid, 'UNREAD', :actionStatus
                FROM slice s
                ON CONFLICT (dedupe_hash) WHERE dedupe_hash IS NOT NULL DO NOTHING
                RETURNING recipient_id
            )
            SELECT (SELECT count(*) FROM slice)    AS scanned,
                   (SELECT count(*) FROM inserted) AS inserted,
                   /*
                    * 실시간 알림을 보낼 사람들. 등록표에서 걸러진 뒤에 남은 <b>새로 받은 사람만</b>
                    * 나온다 — 재배달로 같은 조각을 다시 처리해도 알림이 두 번 뜨지 않는다.
                    * 조각 크기가 상한이라 이 배열은 수신자 총수와 무관하게 일정하다.
                    */
                   (SELECT array_agg(recipient_id) FROM inserted) AS inserted_recipients,
                   -- max(uuid) 집계는 Postgres에 없다. 조각이 이미 user_id 오름차순이므로
                   -- 내림차순 첫 행이 곧 마지막 사람이고, 그게 다음 조각의 시작점이다.
                   (SELECT s.user_id FROM slice s ORDER BY s.user_id DESC LIMIT 1) AS last_user_id
            """;

    /*
     * 곧 시작 알림 전용 조각. 보통의 넓은 팬아웃과 다른 점은 <b>리드타임이 맞는 사람만</b>
     * 고른다는 것이다 — 같은 세션에 예약 행이 선택지 수만큼 있고, 각 행은 자기 리드타임을 고른
     * 사람에게만 나가야 한다.
     *
     * 우선순위는 강의 설정 → 커리큘럼 설정 → 기본값이다. 끄기(enabled=false)는 어느 층에서든
     * 걸리면 제외한다 — 강의별로 켜 두었어도 커리큘럼을 껐으면 그 강의는 <b>덮어쓴 값이 이기므로</b>
     * 강의 설정을 먼저 본다(끄기도 덮어쓰기의 일부다).
     *
     * slice 이후는 INSERT_SLICE와 같은 구조다(content 한 벌 → 등록표 통과 → 통과자만 삽입).
     */
    private static final String INSERT_STARTING_SOON_SLICE = """
            WITH slice AS (
                SELECT e.user_id
                FROM core.enrollment e
                LEFT JOIN core.notification_preference lp
                       ON lp.user_id = e.user_id AND lp.lesson_id = CAST(:lessonId AS uuid)
                LEFT JOIN core.notification_preference cp
                       ON cp.user_id = e.user_id
                      AND cp.curriculum_id = CAST(:curriculumId AS uuid)
                      AND cp.lesson_id IS NULL
                WHERE e.curriculum_id = CAST(:curriculumId AS uuid)
                  AND e.status = 'ACTIVE'
                  AND (CAST(:afterUserId AS uuid) IS NULL OR e.user_id > CAST(:afterUserId AS uuid))
                  -- 이 체인이 맡은 구간의 상한. null이면 끝까지(병렬화 이전과 같다).
                  AND (CAST(:untilUserId AS uuid) IS NULL OR e.user_id <= CAST(:untilUserId AS uuid))
                  AND COALESCE(lp.enabled, cp.enabled, true)
                  AND COALESCE(lp.lead_minutes, cp.lead_minutes, :defaultLead) = :leadMinutes
                ORDER BY e.user_id
                LIMIT :sliceLimit
            ), content AS (
                INSERT INTO core.notification_content (
                    id, type, severity, title, message, targets, group_key,
                    previous_starts_at, next_starts_at)
                SELECT CAST(:contentId AS uuid), :type, :severity, :title, :message,
                       CAST(:targets AS jsonb), :groupKey,
                       CAST(:previousStartsAt AS timestamptz), CAST(:nextStartsAt AS timestamptz)
                WHERE EXISTS (SELECT 1 FROM slice)
                ON CONFLICT (id) DO NOTHING
            ), inserted AS (
                /*
                 * 중복 방지가 이 삽입 안에서 끝난다(ADR-0132). 파티션을 걷어 알림 표에 전역
                 * 유니크를 걸 수 있게 되면서, 등록표에 먼저 넣고 통과분을 조인하던 두 단계가
                 * 한 단계가 됐다 — 알림 1건에 힙 2행·인덱스 4벌이 들던 것이 1행·3벌이다.
                 */
                INSERT INTO core.notification
                        (id, recipient_id, content_id, dedupe_hash, read_status, action_status)
                SELECT gen_random_uuid(), s.user_id, CAST(:contentId AS uuid),
                       md5(:dedupePrefix || s.user_id)::uuid, 'UNREAD', :actionStatus
                FROM slice s
                ON CONFLICT (dedupe_hash) WHERE dedupe_hash IS NOT NULL DO NOTHING
                RETURNING recipient_id
            )
            SELECT (SELECT count(*) FROM slice)    AS scanned,
                   (SELECT count(*) FROM inserted) AS inserted,
                   (SELECT array_agg(recipient_id) FROM inserted) AS inserted_recipients,
                   (SELECT s.user_id FROM slice s ORDER BY s.user_id DESC LIMIT 1) AS last_user_id
            """;

    /*
     * **벤치 전용 스위치.** 조각을 수강생 전원으로 두면 Postgres 익명 메모리가 1,080MB 까지
     * 오른다. 그 메모리를 이 집계가 먹은 것인지 가르려면 그것만 뺀 판이 필요하다 — uuid
     * 100만 개는 16MB 남짓인데 실측은 수신자당 1,000바이트라, 코드만 읽어서는 지목할 수 없다.
     *
     * 끄면 실시간 신호(announceAll)와 푸시 적재가 빈 목록을 받는다. 그래서 기본은 켜짐이고,
     * 끄는 것은 이 비교 측정뿐이다.
     */
    /*
     * **벤치 전용, 순진한 판.** 항목 3이 대는 "DB 왕복 100만 회"는 앱과 DB 사이의 왕복이다.
     * 그 값을 서버 안에서 psql 로 재면 네트워크도 JDBC 도 없어 다른 것을 잰다. 그래서 같은 일을
     * 앱이 행마다 던지는 길을 남겨 두고, 워커의 로그로 두 방식의 소요를 나란히 본다.
     *
     * 집합 삽입 한 문장이 하던 일을 셋으로 가른다 — 명단 조회 한 번, 문구 한 번, 그리고 행마다
     * 삽입. 커서와 훑은 수는 명단에서 나오고, 새로 넣은 사람은 update 가 돌려주는 행 수로 가른다
     * (중복이면 0). 집합 판의 RETURNING 이 하던 구실이다.
     */
    private static final String SLICE_USERS = """
            SELECT e.user_id
            FROM core.enrollment e
            WHERE e.curriculum_id = CAST(:curriculumId AS uuid)
              AND e.status = 'ACTIVE'
              AND (CAST(:afterUserId AS uuid) IS NULL OR e.user_id > CAST(:afterUserId AS uuid))
              AND (CAST(:untilUserId AS uuid) IS NULL OR e.user_id <= CAST(:untilUserId AS uuid))
            ORDER BY e.user_id
            LIMIT :sliceLimit
            """;

    private static final String INSERT_CONTENT_ONE = """
            INSERT INTO core.notification_content (
                id, type, severity, title, message, targets, group_key,
                previous_starts_at, next_starts_at)
            VALUES (CAST(:contentId AS uuid), :type, :severity, :title, :message,
                    CAST(:targets AS jsonb), :groupKey,
                    CAST(:previousStartsAt AS timestamptz), CAST(:nextStartsAt AS timestamptz))
            ON CONFLICT (id) DO NOTHING
            """;

    // 중복 제거 키는 집합 판과 글자까지 같아야 한다. uuid 를 text 로 잇는 자리가 같으므로
    // 같은 사람에게 두 방식이 같은 해시를 만든다.
    private static final String INSERT_ONE = """
            INSERT INTO core.notification
                    (id, recipient_id, content_id, dedupe_hash, read_status, action_status)
            VALUES (gen_random_uuid(), CAST(:userId AS uuid), CAST(:contentId AS uuid),
                    md5(:dedupePrefix || CAST(:userId AS uuid))::uuid, 'UNREAD', :actionStatus)
            ON CONFLICT (dedupe_hash) WHERE dedupe_hash IS NOT NULL DO NOTHING
            """;

    private static final String AGG = "(SELECT array_agg(recipient_id) FROM inserted)";
    private static final String NO_AGG = "NULL::uuid[]";
    private static final String INSERT_SLICE_NO_RECIPIENTS = INSERT_SLICE.replace(AGG, NO_AGG);
    private static final String INSERT_STARTING_SOON_SLICE_NO_RECIPIENTS =
            INSERT_STARTING_SOON_SLICE.replace(AGG, NO_AGG);

    static {
        // 문자열 치환이라 SQL 을 손대면 조용히 안 먹는다. 그러면 두 판이 같은 질의를 돌리고
        // 비교표에 차이 없음이 찍힌다. 기동 때 걸리게 둔다.
        if (INSERT_SLICE_NO_RECIPIENTS.equals(INSERT_SLICE)
                || INSERT_STARTING_SOON_SLICE_NO_RECIPIENTS.equals(INSERT_STARTING_SOON_SLICE)) {
            throw new IllegalStateException("array_agg 자리를 못 찾았다. return-recipients 스위치가 아무 일도 안 한다");
        }
    }

    private final NamedParameterJdbcTemplate jdbc;
    private final boolean returnRecipients;
    private final String insertMode;

    public NotificationFanoutRepository(
            NamedParameterJdbcTemplate jdbc,
            @Value("${notification.fanout.return-recipients:true}") boolean returnRecipients,
            @Value("${notification.fanout.insert-mode:set}") String insertMode) {
        this.jdbc = jdbc;
        this.returnRecipients = returnRecipients;
        this.insertMode = "row".equalsIgnoreCase(insertMode) ? "row" : "set";
    }

    /**
     * 이 체인이 시작한 뒤 흐른 시간(ms). 없으면 {@code null}.
     *
     * <p>기준은 <b>문구 행의 created_at</b>이다. 문구는 첫 슬라이스가 자기 트랜잭션 안에서
     * 한 번만 넣고 그 뒤 슬라이스는 건너뛰므로, 그 시각이 곧 체인이 일을 시작한 시각이다.
     * 기본키 조회 한 번이라 마지막 슬라이스에서 한 번 물어도 부담이 없다.
     *
     * <p>메시지에 시작 시각을 실어 나르지 않는 이유는, 그러려고 명령 스키마를 늘리면 발행하는
     * 곳 전부를 고쳐야 하는데 이 값은 이미 표에 있기 때문이다.
     */
    public Long chainElapsedMs(String dedupePrefix) {
        List<Long> rows = jdbc.queryForList("""
                SELECT round(extract(epoch from (clock_timestamp() - created_at)) * 1000)
                  FROM core.notification_content
                 WHERE id = CAST(:contentId AS uuid)
                """,
                new MapSqlParameterSource("contentId", contentIdOf(dedupePrefix).toString()),
                Long.class);
        return rows.isEmpty() ? null : rows.get(0);
    }

    /**
     * 지금 어느 길로 넣고 있는가. 워커가 로그에 적는다.
     *
     * <p>설정값(set·row)이 아니라 <b>SQL 을 그대로 돌려준다</b>. 이 값은 로그에 찍히고 그
     * 로그가 근거 자료가 되는데, set·row 나 집합·한문장 같은 말은 읽는 사람이 범례를 찾아야
     * 한다. 행마다 INSERT 와 INSERT ... SELECT 는 설명이 필요 없다.
     */
    public String insertModeLabel() {
        return "row".equals(insertMode) ? "행마다 INSERT" : "INSERT ... SELECT";
    }

    /**
     * 커리큘럼의 <b>수강 중(ACTIVE)</b> 학생에게 알림 한 조각을 넣는다.
     *
     * @param afterUserId 커서. {@code null}이면 처음부터.
     * @param dedupePrefix 수신자 id를 이어 붙이기 <b>전까지</b>의 중복 제거 키. 뒤에 user_id가 붙는다.
     *                     문구(content) 행의 id도 여기서 파생한다 — 접두사가 사건을 식별하기 때문이다.
     * @param previousStartsAt 일정 변경 알림에만 값이 있다. 나머지는 {@code null}.
     */
    public Slice insertForActiveStudents(UUID curriculumId, UUID afterUserId, UUID untilUserId,
                                         int sliceLimit,
                                         String type, String actionStatus, String severity,
                                         String title, String message, String targetsJson,
                                         String groupKey, String dedupePrefix,
                                         OffsetDateTime previousStartsAt, OffsetDateTime nextStartsAt) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("curriculumId", curriculumId.toString())
                .addValue("afterUserId", afterUserId == null ? null : afterUserId.toString())
                .addValue("untilUserId", untilUserId == null ? null : untilUserId.toString())
                .addValue("sliceLimit", sliceLimit)
                .addValue("type", type)
                .addValue("actionStatus", actionStatus)
                .addValue("severity", severity)
                .addValue("title", title)
                .addValue("message", message)
                .addValue("targets", targetsJson)
                .addValue("groupKey", groupKey)
                .addValue("dedupePrefix", dedupePrefix)
                .addValue("contentId", contentIdOf(dedupePrefix).toString())
                /*
                 * 일정 변경 알림의 "언제에서 언제로". 문자열로 넘기고 SQL에서 캐스팅한다 —
                 * null일 때 JDBC가 타입을 못 정해 "could not determine data type"으로 터지기 때문이다.
                 */
                .addValue("previousStartsAt", previousStartsAt == null ? null : previousStartsAt.toString())
                .addValue("nextStartsAt", nextStartsAt == null ? null : nextStartsAt.toString());
        if ("row".equals(insertMode)) {
            return insertRowByRow(params, dedupePrefix, actionStatus);
        }
        return jdbc.queryForObject(returnRecipients ? INSERT_SLICE : INSERT_SLICE_NO_RECIPIENTS,
                params, NotificationFanoutRepository::readSlice);
    }

    /**
     * 순진한 판. 명단을 앱으로 가져와 <b>행마다 한 문장씩</b> 던진다. 조각 하나에 왕복이
     * 1 + 1 + 조각 크기만큼 생긴다.
     *
     * <p>벤치에서만 쓴다({@code notification.fanout.insert-mode=row}). 운영은 집합 판이다.
     */
    private Slice insertRowByRow(MapSqlParameterSource params, String dedupePrefix, String actionStatus) {
        List<UUID> users = jdbc.queryForList(SLICE_USERS, params, UUID.class);
        if (users.isEmpty()) {
            return new Slice(0, 0, List.of(), null);
        }
        jdbc.update(INSERT_CONTENT_ONE, params);
        List<UUID> inserted = new ArrayList<>();
        for (UUID user : users) {
            MapSqlParameterSource one = new MapSqlParameterSource()
                    .addValue("userId", user.toString())
                    .addValue("contentId", params.getValue("contentId"))
                    .addValue("dedupePrefix", dedupePrefix)
                    .addValue("actionStatus", actionStatus);
            if (jdbc.update(INSERT_ONE, one) > 0) {
                inserted.add(user);
            }
        }
        return new Slice(users.size(), inserted.size(), inserted, users.get(users.size() - 1));
    }

    /**
     * 곧 시작 알림 한 조각. 리드타임이 맞고 <b>끄지 않은</b> 수강생만 받는다.
     *
     * @param leadMinutes 이 예약 행의 리드타임. 이 값을 고른 사람만 대상이다.
     */
    public Slice insertForStartingSoon(UUID curriculumId, UUID lessonId, UUID afterUserId,
                                       UUID untilUserId, int sliceLimit,
                                       int leadMinutes, int defaultLead,
                                       String type, String actionStatus, String severity,
                                       String title, String message, String targetsJson,
                                       String groupKey, String dedupePrefix,
                                       OffsetDateTime nextStartsAt) {
        MapSqlParameterSource params = new MapSqlParameterSource()
                .addValue("curriculumId", curriculumId.toString())
                .addValue("lessonId", lessonId == null ? null : lessonId.toString())
                .addValue("afterUserId", afterUserId == null ? null : afterUserId.toString())
                .addValue("untilUserId", untilUserId == null ? null : untilUserId.toString())
                .addValue("sliceLimit", sliceLimit)
                .addValue("leadMinutes", leadMinutes)
                .addValue("defaultLead", defaultLead)
                .addValue("type", type)
                .addValue("actionStatus", actionStatus)
                .addValue("severity", severity)
                .addValue("title", title)
                .addValue("message", message)
                .addValue("targets", targetsJson)
                .addValue("groupKey", groupKey)
                .addValue("dedupePrefix", dedupePrefix)
                /*
                 * 리드타임은 content id에 들어가지 않는다(dedupe 접두사에 원래 없다). 같은 회차의
                 * 5분 전·30분 전 발화가 문구도 같으므로 한 content를 나눠 쓴다 — 한 사람은 어차피
                 * 자기 리드타임 하나에만 걸린다.
                 */
                .addValue("contentId", contentIdOf(dedupePrefix).toString())
                .addValue("previousStartsAt", null)
                .addValue("nextStartsAt", nextStartsAt == null ? null : nextStartsAt.toString());
        return jdbc.queryForObject(
                returnRecipients ? INSERT_STARTING_SOON_SLICE : INSERT_STARTING_SOON_SLICE_NO_RECIPIENTS,
                params, NotificationFanoutRepository::readSlice);
    }

    /**
     * 문구 행의 <b>결정적</b> id. 조각들이 커서로 나뉘어 따로 도착해도 같은 사건이면 같은 id에
     * 도달한다 — 첫 조각이 만들고 뒤 조각은 ON CONFLICT로 재사용한다. content id를 커서 메시지에
     * 실어 나르는 안도 있었지만, 그러면 첫 조각의 재배달이 새 content를 만든다(ADR-0123).
     */
    private static UUID contentIdOf(String dedupePrefix) {
        return NotificationInsertRepository.contentIdOf(dedupePrefix);
    }

    private static Slice readSlice(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new Slice(rs.getInt("scanned"), rs.getInt("inserted"),
                recipients(rs.getArray("inserted_recipients")), rs.getObject("last_user_id", UUID.class));
    }

    /** 한 명도 새로 넣지 못했으면 배열 자체가 null이다(전부 중복인 조각). */
    private static List<UUID> recipients(java.sql.Array array) throws java.sql.SQLException {
        if (array == null) {
            return List.of();
        }
        return List.of((UUID[]) array.getArray());
    }
}
