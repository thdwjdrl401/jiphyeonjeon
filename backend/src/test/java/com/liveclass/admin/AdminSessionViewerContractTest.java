package com.liveclass.admin;

import com.liveclass.admin.service.SessionViewerService;
import com.liveclass.learning.repository.LearningProgressRepository;
import com.liveclass.live.service.LivePresenceRegistry;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 운영 콘솔의 "지금 누가 보고 있는가"(ADR-0121).
 *
 * <p>지키려는 것은 <b>이 목록이 거짓말을 하지 않는 것</b> 하나다. 운영자가 이 화면을 보고 강제
 * 정지를 누를지 정하므로, 없는 사람이 있다고 나오거나 있는 사람이 빠지면 판단이 뒤집힌다.
 *
 * <p>가장 중요한 것은 <b>진도 환산 배치가 시청으로 오인되지 않는가</b>이다.
 * {@code learning_progress.updated_at}으로 판정했다면, 녹화가 준비되는 순간(ADR-0117) 그 레슨을 예전에
 * 본 사람 전부가 한꺼번에 "지금 보는 중"으로 올라온다 — 아무도 안 보고 있을 때 가장 크게 틀린다.
 */
@SpringBootTest
@Transactional
class AdminSessionViewerContractTest {

    @Autowired private SessionViewerService viewerService;
    @Autowired private LivePresenceRegistry presenceRegistry;
    @Autowired private LearningProgressRepository progressRepository;
    @Autowired private JdbcTemplate jdbc;

    /** 목록은 강사와 수강생을 갈라 말해야 한다 — "시작은 됐는데 강사가 없는 세션"이 그 값으로 드러난다. */
    @Test
    void the_live_list_tells_the_instructor_from_the_audience() {
        Seed seed = seedLiveSession();
        UUID student = seedUser("수강생", "STUDENT");
        presenceRegistry.join("conn-instructor", seed.sessionId(), seed.instructorId(), true);
        presenceRegistry.join("conn-student", seed.sessionId(), student, false);

        var viewers = viewerService.findBySessionId(seed.sessionId()).orElseThrow();

        assertThat(viewers.live()).hasSize(2);
        assertThat(viewers.live()).filteredOn(SessionViewerService.LiveViewer::instructor)
                .singleElement()
                .satisfies(v -> assertThat(v.displayName()).isEqualTo("강사"));
        assertThat(viewers.live()).filteredOn(v -> !v.instructor())
                .singleElement()
                .satisfies(v -> {
                    assertThat(v.userId()).isEqualTo(student);
                    assertThat(v.displayName())
                            .as("운영자가 누가 듣고 있는지 알려면 이름이 붙어야 한다")
                            .isEqualTo("수강생");
                });
    }

    /** 한 사람이 탭을 두 개 열어도 한 명이다. 연결 수를 세면 인원이 부풀어 판단이 어긋난다. */
    @Test
    void two_tabs_are_still_one_person() {
        Seed seed = seedLiveSession();
        UUID student = seedUser("탭 두 개", "STUDENT");
        presenceRegistry.join("conn-tab-1", seed.sessionId(), student, false);
        presenceRegistry.join("conn-tab-2", seed.sessionId(), student, false);

        var viewers = viewerService.findBySessionId(seed.sessionId()).orElseThrow();

        assertThat(viewers.live()).hasSize(1);
    }

    /** 다른 세션에 들어온 사람이 이 세션 목록에 섞이면 안 된다. */
    @Test
    void someone_in_another_session_does_not_show_up_here() {
        Seed seed = seedLiveSession();
        Seed other = seedLiveSession();
        presenceRegistry.join("conn-elsewhere", other.sessionId(), seedUser("남", "STUDENT"), false);

        var viewers = viewerService.findBySessionId(seed.sessionId()).orElseThrow();

        assertThat(viewers.live()).isEmpty();
    }

    /** 방금 보고한 사람은 어디를 보고 있는지까지 나와야 한다 — 그게 이 목록의 쓸모다. */
    @Test
    void a_recent_report_shows_where_the_viewer_is() {
        Seed seed = seedLiveSession();
        UUID student = seedUser("보는 중", "STUDENT");
        seedWatchReport(seed.lessonId(), student, OffsetDateTime.now().minusSeconds(5));
        seedProgress(seed.lessonId(), student, 754_000L, 42);

        var viewers = viewerService.findBySessionId(seed.sessionId()).orElseThrow();

        assertThat(viewers.replay()).singleElement().satisfies(v -> {
            assertThat(v.userId()).isEqualTo(student);
            assertThat(v.displayName()).isEqualTo("보는 중");
            assertThat(v.lastPositionMs())
                    .as("'어디를 보고 있는가'가 이 값이다")
                    .isEqualTo(754_000L);
            assertThat(v.progressPercent()).isEqualTo(42);
        });
        assertThat(viewers.recentWindowSeconds())
                .as("화면이 같은 기준으로 설명하려면 서버가 창 길이를 함께 줘야 한다")
                .isPositive();
    }

    /** 창을 닫으면 보고가 끊긴다. 끊긴 사람이 남아 있으면 "듣고 있다"고 잘못 말하는 것이다. */
    @Test
    void someone_who_stopped_reporting_drops_out() {
        Seed seed = seedLiveSession();
        UUID student = seedUser("나간 사람", "STUDENT");
        seedWatchReport(seed.lessonId(), student, OffsetDateTime.now().minusHours(3));
        seedProgress(seed.lessonId(), student, 100_000L, 80);

        var viewers = viewerService.findBySessionId(seed.sessionId()).orElseThrow();

        assertThat(viewers.replay()).isEmpty();
    }

    /**
     * <b>이 테스트가 이 파일의 이유다.</b>
     *
     * <p>진도 환산은 녹화가 준비되는 순간 그 레슨의 모든 시청자 행을 한꺼번에 갱신한다(ADR-0117).
     * {@code learning_progress.updated_at}으로 "지금 보는 중"을 판정했다면, 그 한 번의 배치로 몇 달 전에
     * 보고 만 사람까지 전부 접속자로 올라온다. 시청 보고가 실제로 닿은 시각은
     * {@code watch_bucket.updated_at}뿐이다.
     */
    @Test
    void the_progress_settlement_batch_is_not_mistaken_for_watching() {
        Seed seed = seedLiveSession();
        UUID student = seedUser("옛날에 본 사람", "STUDENT");
        seedWatchReport(seed.lessonId(), student, OffsetDateTime.now().minusDays(30));

        // 녹화가 준비돼 진도가 환산된다 — learning_progress.updated_at이 지금으로 갱신된다.
        progressRepository.settleProgressFromWatchBuckets(seed.lessonId(), 10, 90);
        assertThat(jdbc.queryForObject("""
                SELECT updated_at > now() - interval '1 minute' FROM core.learning_progress
                WHERE lesson_id = ? AND user_id = ?
                """, Boolean.class, seed.lessonId(), student))
                .as("배치가 실제로 진도 행을 갱신했다 — 이 전제가 깨지면 아래 검증은 아무것도 지키지 못한다")
                .isTrue();

        var viewers = viewerService.findBySessionId(seed.sessionId()).orElseThrow();

        assertThat(viewers.replay())
                .as("30일 전에 보고 만 사람이 배치 한 번으로 '지금 보는 중'이 되면 안 된다")
                .isEmpty();
    }

    /** 주소로 직접 들어오는 화면이라 "그런 세션 없음"을 분명히 말해야 한다(상세와 같은 규칙). */
    @Test
    void an_unknown_session_has_no_viewers() {
        assertThat(viewerService.findBySessionId(UUID.randomUUID())).isEmpty();
    }

    // ---- helpers ----

    private record Seed(UUID sessionId, UUID lessonId, UUID instructorId) {
    }

    private UUID seedUser(String displayName, String role) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role)
                VALUES (?, ?, 'x', ?, ?)
                """, id, "viewer-" + id + "@liveclass.test", displayName, role);
        return id;
    }

    private Seed seedLiveSession() {
        UUID instructor = seedUser("강사", "INSTRUCTOR");
        UUID curriculum = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.curriculum (id, instructor_id, title, lifecycle_status)
                VALUES (?, ?, '커리큘럼', 'PUBLISHED')
                """, curriculum, instructor);
        UUID section = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.section (id, curriculum_id, title, order_index) VALUES (?, ?, '섹션', 1)
                """, section, curriculum);
        UUID lesson = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.lesson (id, section_id, title, order_index, status)
                VALUES (?, ?, '강의', 1, 'PUBLISHED')
                """, lesson, section);
        UUID session = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.live_session (id, lesson_id, curriculum_id, instructor_id, status, scheduled_at)
                VALUES (?, ?, ?, ?, 'LIVE', now())
                """, session, lesson, curriculum, instructor);
        return new Seed(session, lesson, instructor);
    }

    /** 시청 보고 한 건. {@code updated_at}이 "보고가 서버에 닿은 시각"이다. */
    private void seedWatchReport(UUID lessonId, UUID userId, OffsetDateTime reportedAt) {
        jdbc.update("""
                INSERT INTO core.watch_bucket (lesson_id, user_id, bucket_index, play_count, updated_at)
                VALUES (?, ?, 0, 1, ?)
                """, lessonId, userId, reportedAt);
    }

    private void seedProgress(UUID lessonId, UUID userId, long lastPositionMs, int percent) {
        jdbc.update("""
                INSERT INTO core.learning_progress (user_id, lesson_id, last_position_ms, progress_percent)
                VALUES (?, ?, ?, ?)
                """, userId, lessonId, lastPositionMs, percent);
    }
}
