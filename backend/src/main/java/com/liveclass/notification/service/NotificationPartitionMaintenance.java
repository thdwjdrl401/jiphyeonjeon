package com.liveclass.notification.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.event.EventListener;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.List;

/**
 * core.notification 월 파티션의 선생성·보존 정리(ADR-0123).
 *
 * <p><b>관대한 잡이다.</b> 여기서 무엇이 실패해도 알림 자체는 멈추지 않아야 한다 — 파티션이
 * 없으면 INSERT는 DEFAULT 파티션(에어백)으로 떨어지고, 이 잡이 그 사실을 WARN으로 알린다.
 * 그래서 단계마다 따로 잡고, 던지는 대신 로그를 남긴다.
 *
 * <p><b>보존은 DELETE가 아니라 파티션 DROP이다.</b> 오래된 알림 수백만 행을 DELETE하면 시간이
 * 걸리고 죽은 튜플·인덱스 팽창이 남지만, DROP은 파일을 지우는 것이라 몇 ms로 끝난다. 월 단위로
 * 자른 이유가 이것이다. 중복 제거 등록표(core.notification_dedupe)는 <b>지우지 않는다</b> —
 * 파티션이 사라져도 지난 사건이 되살아나 다시 알리면 안 된다.
 *
 * <p><b>단일 인스턴스 전제다</b>(LiveStartingSoonScheduler와 같은 전제). 늘리면 두 인스턴스가
 * 같은 DDL을 동시에 시도한다 — IF NOT EXISTS라 깨지지는 않지만 잠금 경합이 생긴다.
 */
@Component
public class NotificationPartitionMaintenance {

    private static final Logger log = LoggerFactory.getLogger(NotificationPartitionMaintenance.class);

    private final JdbcTemplate jdbc;
    private final int monthsAhead;
    private final int retentionMonths;

    public NotificationPartitionMaintenance(
            JdbcTemplate jdbc,
            @Value("${notification.partition.months-ahead:3}") int monthsAhead,
            @Value("${notification.retention.months:12}") int retentionMonths) {
        this.jdbc = jdbc;
        this.monthsAhead = monthsAhead;
        this.retentionMonths = retentionMonths;
    }

    /**
     * 매일 새벽 + 기동 직후 한 번. 기동 직후에도 도는 이유는, 서버가 몇 달 내려가 있다 떠도
     * 다음 새벽까지 DEFAULT 파티션에 쌓이는 창을 두지 않기 위해서다. 멱등이라 몇 번 돌아도 같다.
     */
    @Scheduled(cron = "${notification.partition.maintenance-cron:0 40 4 * * *}")
    public void maintain() {
        ensureUpcomingPartitions();
        warnIfAirbagCaughtRows();
        dropExpiredPartitions();
    }

    @EventListener(ApplicationReadyEvent.class)
    public void onStartup() {
        maintain();
    }

    /**
     * 이번 달부터 앞으로 {@code monthsAhead}개월치를 선생성한다. 경계는 마이그레이션(V45)과 같은
     * 서버 시간대(UTC) 달 경계다 — 두 기준이 다르면 파티션이 겹쳐 생성이 실패한다.
     *
     * @return 생성에 실패한 달들. 정상이면 비어 있다 — IF NOT EXISTS라 이미 있는 달은 실패가 아니다.
     */
    public List<YearMonth> ensureUpcomingPartitions() {
        List<YearMonth> failed = new java.util.ArrayList<>();
        YearMonth month = YearMonth.now(ZoneOffset.UTC);
        for (int i = 0; i <= monthsAhead; i++, month = month.plusMonths(1)) {
            try {
                // 식별자를 이어 붙이지만 주입 표면이 아니다 — 조각이 전부 여기서 계산한 날짜다.
                jdbc.execute(("CREATE TABLE IF NOT EXISTS core.%s PARTITION OF core.notification "
                        + "FOR VALUES FROM ('%s') TO ('%s') WITH (fillfactor = 90)")
                        .formatted(partitionName(month),
                                month.atDay(1), month.plusMonths(1).atDay(1)));
            } catch (RuntimeException e) {
                /*
                 * 대표 원인: DEFAULT 파티션에 이 달 범위의 행이 이미 있다(에어백이 받아 둔 상태).
                 * 그 행을 옮기는 일은 운영 판단이 필요하므로 여기서 자동으로 하지 않는다 — 잡은
                 * 다음 달 생성을 계속 시도하고, 아래 WARN이 상황을 계속 알린다.
                 */
                log.warn("알림 파티션 생성 실패 month={} — 계속 진행: {}", month, e.getMessage());
                failed.add(month);
            }
        }
        return failed;
    }

    /**
     * 에어백(DEFAULT 파티션)에 행이 있으면 WARN. 정상 운영에서는 항상 0이어야 한다 — 있다는 것은
     * 선생성이 어디선가 멈췄다는 뜻이고, 조용히 두면 그 사실을 아무도 모른 채 쌓인다.
     */
    public long warnIfAirbagCaughtRows() {
        Long count = jdbc.queryForObject("SELECT count(*) FROM core.notification_default", Long.class);
        long rows = count == null ? 0 : count;
        if (rows > 0) {
            log.warn("알림 DEFAULT 파티션에 {}행이 있다 — 월 파티션 선생성이 실패하고 있는지 확인하라. "
                    + "해당 달 파티션을 만들려면 이 행들을 먼저 옮겨야 한다(ADR-0123).", rows);
        }
        return rows;
    }

    /**
     * 보존 기간({@code notification.retention.months}, 기본 12)을 지난 달의 파티션을 DROP한다.
     *
     * <p>보존 정책 자체는 미확정이다 — 기본값을 보수적으로(12개월) 두고 설정으로 조절한다
     * (ADR-0123). 어느 파티션이 어느 달인지는 <b>이름에서</b> 읽는다: 파티션은 전부 마이그레이션과
     * 이 잡이 {@code notification_pYYYY_MM}로 만들므로 이름이 곧 경계다. relpartbound를 파싱하는
     * 것보다 단순하고, 이름이 다른 파티션(수동 개입 흔적)은 건드리지 않게 되는 안전판도 겸한다.
     */
    public List<String> dropExpiredPartitions() {
        YearMonth cutoff = YearMonth.now(ZoneOffset.UTC).minusMonths(retentionMonths);
        List<String> dropped = jdbc.queryForList("""
                SELECT c.relname
                FROM pg_inherits i
                JOIN pg_class c ON c.oid = i.inhrelid
                JOIN pg_class p ON p.oid = i.inhparent
                JOIN pg_namespace n ON n.oid = p.relnamespace
                WHERE n.nspname = 'core' AND p.relname = 'notification'
                  AND c.relname ~ '^notification_p[0-9]{4}_[0-9]{2}$'
                """, String.class).stream()
                .filter(name -> monthOf(name).isBefore(cutoff))
                .toList();
        for (String name : dropped) {
            try {
                // DROP이 곧 보존 정리다. 등록표는 남는다 — dedupe가 보존 기간을 넘어 유지된다.
                jdbc.execute("DROP TABLE IF EXISTS core." + name);
                log.info("보존 기간({}개월)이 지난 알림 파티션 삭제: {}", retentionMonths, name);
            } catch (RuntimeException e) {
                log.warn("알림 파티션 삭제 실패 {} — 다음 주기에 다시 시도: {}", name, e.getMessage());
            }
        }
        return dropped;
    }

    private static String partitionName(YearMonth month) {
        return "notification_p%04d_%02d".formatted(month.getYear(), month.getMonthValue());
    }

    private static YearMonth monthOf(String partitionName) {
        String suffix = partitionName.substring("notification_p".length());
        LocalDate first = LocalDate.of(Integer.parseInt(suffix.substring(0, 4)),
                Integer.parseInt(suffix.substring(5, 7)), 1);
        return YearMonth.from(first);
    }
}
