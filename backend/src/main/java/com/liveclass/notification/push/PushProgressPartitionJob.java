package com.liveclass.notification.push;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 진행 표({@code core.notification_push_progress})의 일 파티션 관리(ADR-0124, V46).
 *
 * <p>세 가지를 한다 — 앞으로 14일치 <b>선생성</b>, 7일 지난 파티션 <b>DROP</b>(지우기가 공짜인
 * 이유로 파티션을 골랐다), DEFAULT 파티션 <b>에어백 점검</b>(행이 있으면 선생성이 밀렸다는 뜻).
 *
 * <p><b>관대한 잡이다.</b> 늦어도(14일치 선생성분이 버틴다), 겹쳐도(IF NOT EXISTS·DROP IF EXISTS로
 * 멱등), 몇 번 빠져도(다음 주기가 밀린 만큼 한꺼번에 한다) 무해하다. 그래서 잠금도, 정확한 주기도,
 * 실패 재시도도 필요 없다 — 하루 안에 한 번만 성공하면 된다.
 *
 * <p>날짜별 실패는 <b>그 날짜만 접고 계속 간다.</b> DEFAULT에 어떤 날짜의 행이 떨어져 있으면 그
 * 날짜의 파티션 생성은 실패하는데(경계 검증), 그것 때문에 뒤 날짜들의 선생성까지 멈추면 안 된다.
 *
 * <p>경계·이름은 <b>UTC 자정</b> 기준이다. 마이그레이션(V46)과 같은 기준이어야 IF NOT EXISTS가
 * 같은 파티션을 알아본다.
 */
@Component
public class PushProgressPartitionJob {

    private static final Logger log = LoggerFactory.getLogger(PushProgressPartitionJob.class);
    private static final DateTimeFormatter DAY = DateTimeFormatter.BASIC_ISO_DATE;
    private static final Pattern DAY_PARTITION = Pattern.compile("notification_push_progress_p(\\d{8})");

    /** 앞으로 며칠치를 미리 만들어 두나. 잡이 이만큼 연속으로 실패해야 비로소 DEFAULT로 샌다. */
    private static final int DAYS_AHEAD = 14;
    /** 며칠 지난 기록을 지우나. 재배달 창(분 단위)보다 넉넉히 길면 된다. */
    private static final int RETENTION_DAYS = 7;

    private final JdbcTemplate jdbc;

    public PushProgressPartitionJob(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * 기동 직후 한 번, 이후 주기적으로. 기동 직후에 도는 이유는 서버가 선생성분(14일)보다 오래
     * 꺼져 있다 되살아났을 때 첫 푸시가 DEFAULT로 새기 전에 파티션을 채워 넣기 위해서다.
     */
    @Scheduled(fixedDelayString = "${notification.push.partition-maintenance-ms:21600000}",
            initialDelayString = "${notification.push.partition-initial-delay-ms:15000}")
    public void maintain() {
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        for (int i = 0; i <= DAYS_AHEAD; i++) {
            createDay(today.plusDays(i));
        }
        dropBefore(today.minusDays(RETENTION_DAYS));
        warnIfDefaultCaughtRows();
    }

    /*
     * 파티션 이름·경계를 문자열로 조립하지만 주입 표면이 아니다 — 들어가는 값이 전부 이 클래스가
     * 만든 날짜뿐이다. PG16은 UNLOGGED를 파티션에 상속하지 않으므로 매번 명시한다(V46 주석).
     */
    private void createDay(LocalDate day) {
        String partition = "notification_push_progress_p" + DAY.format(day);
        try {
            jdbc.execute(("CREATE UNLOGGED TABLE IF NOT EXISTS core.%s "
                    + "PARTITION OF core.notification_push_progress "
                    + "FOR VALUES FROM ('%s 00:00:00+00') TO ('%s 00:00:00+00')")
                    .formatted(partition, day, day.plusDays(1)));
            // 파티션 지역 유니크(V46 주석 — 전역 유니크는 파티션 키 제약으로 불가). anti-join이 탄다.
            jdbc.execute("CREATE UNIQUE INDEX IF NOT EXISTS %s_key ON core.%s (event_hash, recipient_id)"
                    .formatted(partition, partition));
        } catch (RuntimeException e) {
            log.warn("진행 표 파티션 선생성 실패(이 날짜만 접고 계속) partition={}: {}", partition, e.getMessage());
        }
    }

    /** 이름의 날짜가 기준보다 오래된 파티션만 지운다. DEFAULT는 이름 패턴에 안 걸려 절대 안 지워진다. */
    private void dropBefore(LocalDate cutoff) {
        List<String> children = jdbc.queryForList("""
                SELECT c.relname
                FROM pg_inherits i
                JOIN pg_class c ON c.oid = i.inhrelid
                JOIN pg_class parent ON parent.oid = i.inhparent
                JOIN pg_namespace n ON n.oid = parent.relnamespace
                WHERE n.nspname = 'core' AND parent.relname = 'notification_push_progress'
                """, String.class);
        for (String child : children) {
            Matcher matcher = DAY_PARTITION.matcher(child);
            if (!matcher.matches()) {
                continue;
            }
            LocalDate day = LocalDate.parse(matcher.group(1), DAY);
            if (!day.isBefore(cutoff)) {
                continue;
            }
            try {
                // 파티션 DROP은 detach를 겸한다. UNLOGGED 소용량이라 잠금은 순간이다.
                jdbc.execute("DROP TABLE IF EXISTS core." + child);
                log.info("진행 표 파티션 정리 partition={}", child);
            } catch (RuntimeException e) {
                log.warn("진행 표 파티션 정리 실패(다음 주기에 다시) partition={}: {}", child, e.getMessage());
            }
        }
    }

    /**
     * DEFAULT 파티션은 에어백이다 — 여기 행이 있다는 것은 그 날짜의 파티션이 없었다는 뜻이고,
     * 그 날짜의 선생성은 계속 실패한다(경계 검증). 자동으로 옮기지 않는 이유는, 옮기기(재삽입 후
     * 삭제)가 발송 진행 기록을 잠깐 안 보이게 만들 수 있어서다 — 사람이 보고 정리할 일로 남긴다.
     */
    private void warnIfDefaultCaughtRows() {
        Boolean caught = jdbc.queryForObject(
                "SELECT EXISTS (SELECT 1 FROM core.notification_push_progress_default)", Boolean.class);
        if (Boolean.TRUE.equals(caught)) {
            log.warn("진행 표 DEFAULT 파티션에 행이 있습니다 — 파티션 선생성이 밀렸던 흔적입니다. "
                    + "해당 날짜 행을 옮기거나 지우기 전까지 그 날짜의 파티션 생성이 실패합니다.");
        }
    }
}
