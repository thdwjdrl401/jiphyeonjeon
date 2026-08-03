package com.liveclass.notification;

import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.domain.NotificationStatus;
import com.liveclass.notification.repository.NotificationFanoutRepository;
import com.liveclass.notification.repository.NotificationFanoutRepository.Slice;
import com.liveclass.notification.service.NotificationPreferenceService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 리드타임이 실제로 <b>대상을 가르는지</b>(ADR-0073 4단계).
 *
 * <p>예약 행은 선택지 전부에 대해 있고, 각 행은 <b>자기 리드타임을 고른 사람에게만</b> 나가야 한다.
 * 이게 어긋나면 30분 전으로 설정한 사람이 10분 전에도 알림을 받거나, 아무 알림도 못 받는다.
 *
 * <p>설정을 안 한 사람은 기본값(10분) 조각에 걸린다 — 행이 없다고 빠지면 대부분의 사용자가 알림을
 * 못 받는다.
 */
@SpringBootTest
@Transactional
class StartingSoonLeadTimeFanoutTest {

    @Autowired private NotificationFanoutRepository fanoutRepository;
    @Autowired private NotificationPreferenceService preferenceService;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private jakarta.persistence.EntityManager entityManager;

    @Test
    void each_lead_slice_reaches_only_the_people_who_chose_it() {
        Fixture f = fixture();
        UUID untouched = enroll(f.curriculumId);                 // 설정 없음 → 기본 10분
        UUID thirty = enroll(f.curriculumId);
        UUID fiveByLesson = enroll(f.curriculumId);
        preferenceService.save(thirty, f.curriculumId, null, true, 30);
        preferenceService.save(fiveByLesson, f.curriculumId, null, true, 30);
        preferenceService.save(fiveByLesson, f.curriculumId, f.lessonId, true, 5);   // 강의가 이긴다

        assertThat(sliceFor(f, 10).insertedRecipients())
                .as("설정하지 않은 사람은 기본값 조각에 걸린다")
                .containsExactly(untouched);
        assertThat(sliceFor(f, 30).insertedRecipients()).containsExactly(thirty);
        assertThat(sliceFor(f, 5).insertedRecipients())
                .as("강의 설정이 커리큘럼을 덮어쓴다")
                .containsExactly(fiveByLesson);
        assertThat(sliceFor(f, 60).insertedRecipients())
                .as("아무도 고르지 않은 리드타임은 0건으로 끝난다")
                .isEmpty();
    }

    /** 끈 사람은 어느 조각에도 들어가지 않는다. */
    @Test
    void someone_who_turned_it_off_is_in_no_slice_at_all() {
        Fixture f = fixture();
        UUID off = enroll(f.curriculumId);
        preferenceService.save(off, f.curriculumId, null, false, 10);

        for (int lead : com.liveclass.notification.api.NotificationLeadTimes.CHOICES) {
            assertThat(sliceFor(f, lead).insertedRecipients())
                    .as("리드타임 %d 조각", lead)
                    .doesNotContain(off);
        }
    }

    /** 커리큘럼을 껐어도 그 강의만 켜 두었으면 받는다 — 끄기도 덮어쓰기의 일부다. */
    @Test
    void a_lesson_level_on_beats_a_curriculum_level_off() {
        Fixture f = fixture();
        UUID user = enroll(f.curriculumId);
        preferenceService.save(user, f.curriculumId, null, false, 10);
        preferenceService.save(user, f.curriculumId, f.lessonId, true, 30);

        assertThat(sliceFor(f, 30).insertedRecipients()).containsExactly(user);
    }

    // ---- helpers ----

    private record Fixture(UUID curriculumId, UUID lessonId) {
    }

    private Slice sliceFor(Fixture f, int leadMinutes) {
        // 설정은 JPA로 저장했고 조각은 네이티브 SQL이다 — 플러시하지 않으면 설정이 보이지 않는다.
        entityManager.flush();
        return fanoutRepository.insertForStartingSoon(
                f.curriculumId, f.lessonId, null, 100, leadMinutes,
                com.liveclass.notification.api.NotificationLeadTimes.DEFAULT_MINUTES,
                NotificationTypes.LIVE_STARTING_SOON, NotificationStatus.INFO, NotificationStatus.HIGH,
                "라이브가 곧 시작합니다", "«강의» 라이브가 곧 시작합니다.",
                "{\"curriculumId\":\"" + f.curriculumId + "\"}",
                NotificationTypes.LIVE_STARTING_SOON + ':' + f.curriculumId,
                // 리드타임마다 다른 접두사를 줘야 조각끼리 서로를 중복으로 지우지 않는다.
                NotificationTypes.LIVE_STARTING_SOON + ":lead" + leadMinutes + ':' + f.lessonId + ':',
                OffsetDateTime.now().plusHours(1));
    }

    private Fixture fixture() {
        UUID instructorId = seedUser();
        UUID curriculumId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.curriculum (id, instructor_id, title, lifecycle_status)
                VALUES (?, ?, ?, 'PUBLISHED')
                """, curriculumId, instructorId, "리드타임 커리큘럼");
        UUID sectionId = UUID.randomUUID();
        jdbc.update("INSERT INTO core.section (id, curriculum_id, title, order_index) VALUES (?, ?, ?, 0)",
                sectionId, curriculumId, "섹션");
        UUID lessonId = UUID.randomUUID();
        jdbc.update("INSERT INTO core.lesson (id, section_id, title, order_index) VALUES (?, ?, ?, 0)",
                lessonId, sectionId, "강의");
        return new Fixture(curriculumId, lessonId);
    }

    private UUID enroll(UUID curriculumId) {
        UUID userId = seedUser();
        jdbc.update("""
                INSERT INTO core.enrollment (id, curriculum_id, user_id, status, requested_at)
                VALUES (?, ?, ?, 'ACTIVE', now())
                """, UUID.randomUUID(), curriculumId, userId);
        return userId;
    }

    private UUID seedUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role, status)
                VALUES (?, ?, 'x', ?, 'STUDENT', 'ACTIVE')
                """, id, "lead-" + id + "@liveclass.test", "테스터");
        return id;
    }
}
