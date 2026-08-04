package com.liveclass.notification;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * V35 백필 검증 — <b>이미 쌓여 버린</b> 처리 대기 알림을 닫는다.
 *
 * <p>코드 수정은 앞으로 생길 알림에만 듣는다. 운영에는 이 결정 이전에 만들어진 알림이 남아 있고,
 * 그것들이 바로 사용자가 본 "처리 대기 1인데 신청자가 없다"의 실체다. 그래서 마이그레이션이
 * <b>무엇을 어떻게 닫는지</b>를 따로 지킨다.
 *
 * <p><b>SQL을 테스트에 옮겨 적지 않는다.</b> 마이그레이션 파일을 그대로 읽어 실행한다 — 옮겨 적으면
 * 그 사본이 통과할 뿐이고, 정작 운영에서 도는 쪽이 바뀌어도 아무도 모른다.
 *
 * <p>이 마이그레이션은 이미 컨텍스트 기동 때 한 번 돌았다. 여기서 다시 도는 것이 안전한 이유는
 * {@code ACTION_REQUIRED}만 건드리기 때문이다 — 두 번 돌려도 결과가 같다.
 */
@SpringBootTest
@Transactional
class StaleEnrollmentNotificationBackfillTest {

    private static final String MIGRATION = "db/migration/V35__settle_stale_enrollment_notifications.sql";

    @Autowired private JdbcTemplate jdbc;

    @Test
    void it_settles_handled_requests_and_leaves_the_pending_one_alone() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID curriculum = seedCurriculum(instructor);

        UUID approved = seedStaleRequest(instructor, curriculum, "ACTIVE");
        UUID rejected = seedStaleRequest(instructor, curriculum, "REJECTED");
        UUID withdrawn = seedStaleRequest(instructor, curriculum, "CANCELLED");
        UUID revoked = seedStaleRequest(instructor, curriculum, "REVOKED");
        UUID stillPending = seedStaleRequest(instructor, curriculum, "PENDING");
        UUID orphaned = seedNotification(instructor, UUID.randomUUID(), curriculum);

        jdbc.execute(new String(new ClassPathResource(MIGRATION).getInputStream().readAllBytes(),
                StandardCharsets.UTF_8));

        assertThat(actionStatusOf(approved))
                .as("강사가 승인했다 — 처리한 것이다")
                .isEqualTo("COMPLETED");
        assertThat(actionStatusOf(rejected)).isEqualTo("COMPLETED");
        assertThat(actionStatusOf(withdrawn))
                .as("학생이 물렀다 — 강사는 한 일이 없다")
                .isEqualTo("EXPIRED");
        assertThat(actionStatusOf(revoked)).isEqualTo("EXPIRED");
        assertThat(actionStatusOf(orphaned))
                .as("수강 행이 사라진 알림은 갈 곳이 없다")
                .isEqualTo("EXPIRED");
        assertThat(actionStatusOf(stillPending))
                .as("아직 강사가 처리해야 할 일이다 — 이걸 닫으면 진짜 할 일이 사라진다")
                .isEqualTo("ACTION_REQUIRED");
    }

    /** 읽음 축은 처리 축과 따로 움직인다. 백필이 읽음 상태를 건드리면 안 읽은 알림이 사라진다. */
    @Test
    void it_does_not_touch_the_read_axis() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID curriculum = seedCurriculum(instructor);
        UUID id = seedStaleRequest(instructor, curriculum, "ACTIVE");

        jdbc.execute(new String(new ClassPathResource(MIGRATION).getInputStream().readAllBytes(),
                StandardCharsets.UTF_8));

        assertThat(jdbc.queryForObject("SELECT read_status FROM core.notification WHERE id = ?",
                String.class, id)).isEqualTo("UNREAD");
    }

    // ---- helpers ----

    private String actionStatusOf(UUID id) {
        return jdbc.queryForObject("SELECT action_status FROM core.notification WHERE id = ?", String.class, id);
    }

    /** 수강 행이 {@code status}인데 알림은 여전히 처리 대기인, 운영에 남아 있는 그 모양. */
    private UUID seedStaleRequest(UUID instructor, UUID curriculum, String status) throws Exception {
        UUID student = seedUser("STUDENT");
        UUID enrollment = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.enrollment (id, curriculum_id, user_id, status, requested_at)
                VALUES (?, ?, ?, ?, now())
                """, enrollment, curriculum, student, status);
        return seedNotification(instructor, enrollment, curriculum);
    }

    private UUID seedNotification(UUID recipient, UUID enrollment, UUID curriculum) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.notification
                       (id, recipient_id, type, read_status, action_status, severity,
                        title, message, targets, group_key, dedupe_key)
                VALUES (?, ?, 'ENROLLMENT_REQUESTED', 'UNREAD', 'ACTION_REQUIRED', 'NORMAL',
                        '수강 신청', '신청이 들어왔습니다', ?::jsonb, ?, ?)
                """, id, recipient,
                "{\"curriculumId\":\"%s\",\"enrollmentId\":\"%s\"}".formatted(curriculum, enrollment),
                "backfill:" + curriculum, "backfill:" + id);
        return id;
    }

    private UUID seedCurriculum(UUID instructor) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.curriculum (id, instructor_id, title, lifecycle_status)
                VALUES (?, ?, '백필 대상', 'PUBLISHED')
                """, id, instructor);
        return id;
    }

    private UUID seedUser(String role) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role)
                VALUES (?, ?, 'x', '테스터', ?)
                """, id, "backfill-" + id + "@liveclass.test", role);
        return id;
    }
}
