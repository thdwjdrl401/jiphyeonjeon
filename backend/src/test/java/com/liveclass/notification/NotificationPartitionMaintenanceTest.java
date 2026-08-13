package com.liveclass.notification;

import com.liveclass.notification.api.NewNotification;
import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.repository.NotificationInsertRepository;
import com.liveclass.notification.service.NotificationPartitionMaintenance;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.UUID;

import static com.liveclass.notification.domain.NotificationStatus.INFO;
import static org.assertj.core.api.Assertions.assertThat;

/**
 * 월 파티션 관리 잡(ADR-0123 §B·§C).
 *
 * <p>지키려는 것은 셋이다 — <b>선생성이 멱등인가</b>(매일 도는 잡이 어제 만든 파티션에 걸려
 * 넘어지면 안 된다), <b>파티션 밖의 행이 INSERT를 죽이는 대신 에어백에 잡히는가</b>,
 * <b>보존 DROP이 지나도 중복 제거가 살아 있는가</b>.
 *
 * <p>마지막이 이 설계의 요점이다. 등록표를 본체와 함께 파티셔닝했거나 파티션 DROP이 등록표까지
 * 지운다면, 지난 사건(예: 철회했다 재공개한 다시보기)이 보존 기간 뒤에 <b>다시 알린다</b> —
 * dedupe는 월도 보존 정책도 넘어야 한다.
 *
 * <p>DDL도 트랜잭션이라 롤백이 만들고 지운 파티션을 전부 되돌린다 — 공유 테스트 DB에 흔적이
 * 남지 않는다.
 */
@SpringBootTest
@Transactional
class NotificationPartitionMaintenanceTest {

    @Autowired private NotificationPartitionMaintenance maintenance;
    @Autowired private NotificationInsertRepository insertRepository;
    @Autowired private JdbcTemplate jdbc;

    @Test
    void creating_partitions_twice_is_idempotent() {
        assertThat(maintenance.ensureUpcomingPartitions()).isEmpty();
        // 매일 도는 잡이다 — 어제 만든 파티션이 이미 있어도 실패가 아니어야 한다.
        assertThat(maintenance.ensureUpcomingPartitions()).isEmpty();

        YearMonth next = YearMonth.now(ZoneOffset.UTC).plusMonths(1);
        assertThat(partitionExists("notification_p%04d_%02d"
                .formatted(next.getYear(), next.getMonthValue()))).isTrue();
    }

    /**
     * 어느 파티션에도 안 맞는 행은 INSERT 실패가 아니라 DEFAULT 파티션으로 떨어져야 하고,
     * 잡이 그 사실을 알아채야 한다. 에어백이 없으면 선생성이 멈춘 달의 첫 알림부터 팬아웃
     * 전체가 죽는다.
     */
    @Test
    void a_row_beyond_the_precreated_months_lands_in_the_airbag() {
        int inserted = insertAt("airbag-" + UUID.randomUUID(),
                OffsetDateTime.parse("2123-01-15T00:00:00Z"));

        assertThat(inserted).isEqualTo(1);
        assertThat(maintenance.warnIfAirbagCaughtRows())
                .as("에어백에 잡힌 행 수를 잡이 보고한다(0이 아니면 WARN)")
                .isPositive();
    }

    @Test
    void retention_drops_old_partitions_but_dedupe_survives_the_drop() {
        // 보존 기간(기본 12개월)을 훌쩍 지난 달의 파티션을 만들고 그 달의 알림을 하나 넣는다.
        jdbc.execute("""
                CREATE TABLE core.notification_p2020_01 PARTITION OF core.notification
                FOR VALUES FROM ('2020-01-01') TO ('2020-02-01') WITH (fillfactor = 90)
                """);
        String dedupeKey = "retention-" + UUID.randomUUID();
        assertThat(insertAt(dedupeKey, OffsetDateTime.parse("2020-01-15T00:00:00Z"))).isEqualTo(1);

        assertThat(maintenance.dropExpiredPartitions()).contains("notification_p2020_01");
        assertThat(partitionExists("notification_p2020_01")).isFalse();

        /*
         * 여기가 핵심이다. 행은 파티션과 함께 사라졌지만 같은 사건이 다시 와도 알리지 않아야
         * 한다 — 등록표는 파티셔닝하지 않고 영구라서다. 이게 깨지면 재공개·재전송류 사건이
         * 보존 기간마다 한 번씩 되살아난다.
         */
        assertThat(insertAt(dedupeKey, OffsetDateTime.parse("2020-01-15T00:00:00Z")))
                .as("파티션이 사라져도 같은 사건은 여전히 0건이다")
                .isZero();
    }

    /** 이번 달처럼 아직 보존 기간 안인 파티션은 건드리지 않는다. */
    @Test
    void retention_leaves_partitions_inside_the_window_alone() {
        YearMonth now = YearMonth.now(ZoneOffset.UTC);
        maintenance.dropExpiredPartitions();

        assertThat(partitionExists("notification_p%04d_%02d"
                .formatted(now.getYear(), now.getMonthValue()))).isTrue();
    }

    // ---- helpers ----

    /**
     * 알림 한 건을 원하는 시각에 넣는다. 삽입 경로는 실제 코드(등록표 CTE)를 그대로 쓰고,
     * created_at만 뒤에서 옮긴다 — 파티션 라우팅은 행의 값이 정하므로 UPDATE가 행을 맞는
     * 파티션으로 옮겨 준다.
     */
    private int insertAt(String dedupeKey, OffsetDateTime createdAt) {
        UUID recipient = seedUser();
        int inserted = insertRepository.insert(NewNotification.of(
                recipient, NotificationTypes.VOD_PUBLISHED, INFO,
                NotificationTypes.severityOf(NotificationTypes.VOD_PUBLISHED),
                "다시보기", "다시보기가 공개되었습니다.", "{}",
                "VOD_PUBLISHED:partition-test", dedupeKey));
        if (inserted > 0) {
            jdbc.update("UPDATE core.notification SET created_at = ? WHERE recipient_id = ?",
                    createdAt, recipient);
        }
        return inserted;
    }

    private boolean partitionExists(String name) {
        Long count = jdbc.queryForObject("""
                SELECT count(*) FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'core' AND c.relname = ?
                """, Long.class, name);
        return count != null && count > 0;
    }

    private UUID seedUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role, status)
                VALUES (?, ?, 'x', '테스터', 'STUDENT', 'ACTIVE')
                """, id, "part-" + id + "@liveclass.test");
        return id;
    }
}
