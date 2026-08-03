package com.liveclass.notification;

import com.liveclass.notification.api.NotificationLeadTimes;
import com.liveclass.notification.service.NotificationPreferenceService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 곧 시작 알림 설정(ADR-0073 4단계).
 *
 * <p>지키려는 것은 넷이다 — <b>덮어쓰기 순서가 강의 → 커리큘럼 → 기본값인가</b>, <b>끄기가 덮어쓰기의
 * 일부인가</b>, <b>"행이 없다"와 "꺼 뒀다"가 구별되는가</b>, <b>선택지 밖 값을 막는가</b>.
 *
 * <p>세 번째가 미묘하다. 끄기를 {@code leadMinutes = null}로 표현하면 <b>기본값이 바뀌는 날 꺼 둔
 * 사람에게 알림이 되살아난다</b> — 그래서 {@code enabled}를 따로 뒀다.
 */
@SpringBootTest
@Transactional
class NotificationPreferenceContractTest {

    @Autowired private NotificationPreferenceService preferenceService;
    @Autowired private JdbcTemplate jdbc;

    @Test
    void with_no_setting_at_all_the_default_applies() {
        Fixture f = fixture();

        var effective = preferenceService.effective(f.userId, f.curriculumId, f.lessonId);

        assertThat(effective.enabled()).isTrue();
        assertThat(effective.leadMinutes()).isEqualTo(NotificationLeadTimes.DEFAULT_MINUTES);
        assertThat(effective.source())
                .as("어디서 온 값인지 알려 준다 — 값만 주면 사용자가 자기가 어디를 고쳤는지 모른다")
                .isEqualTo("DEFAULT");
    }

    @Test
    void a_curriculum_setting_applies_to_its_lessons() {
        Fixture f = fixture();
        preferenceService.save(f.userId, f.curriculumId, null, true, 60);

        var effective = preferenceService.effective(f.userId, f.curriculumId, f.lessonId);

        assertThat(effective.leadMinutes()).isEqualTo(60);
        assertThat(effective.source()).isEqualTo("CURRICULUM");
    }

    /** 강의 설정이 커리큘럼을 이긴다. 그게 "덮어쓰기"의 뜻이다. */
    @Test
    void a_lesson_setting_wins_over_the_curriculum() {
        Fixture f = fixture();
        preferenceService.save(f.userId, f.curriculumId, null, true, 60);
        preferenceService.save(f.userId, f.curriculumId, f.lessonId, true, 5);

        var effective = preferenceService.effective(f.userId, f.curriculumId, f.lessonId);

        assertThat(effective.leadMinutes()).isEqualTo(5);
        assertThat(effective.source()).isEqualTo("LESSON");
    }

    /**
     * <b>끄기도 덮어쓰기의 일부다.</b> 커리큘럼을 꺼 두고 특정 강의만 켤 수 있어야, "이 강의는 놓치면
     * 안 된다"를 표현할 수 있다.
     */
    @Test
    void a_lesson_can_be_turned_back_on_while_the_curriculum_is_off() {
        Fixture f = fixture();
        preferenceService.save(f.userId, f.curriculumId, null, false, 10);
        preferenceService.save(f.userId, f.curriculumId, f.lessonId, true, 30);

        assertThat(preferenceService.effective(f.userId, f.curriculumId, f.lessonId).enabled()).isTrue();
        assertThat(preferenceService.effective(f.userId, f.curriculumId, null).enabled())
                .as("다른 강의는 여전히 꺼져 있다")
                .isFalse();
    }

    /**
     * 끈 사람은 <b>설정하지 않은 사람과 달라야 한다</b>. 끄기를 leadMinutes=null로 표현했다면 둘이
     * 같아 보이고, 기본값이 바뀌는 날 꺼 둔 사람에게 알림이 되살아난다.
     */
    @Test
    void turning_it_off_is_distinguishable_from_never_setting_it() {
        Fixture f = fixture();
        preferenceService.save(f.userId, f.curriculumId, null, false, 10);

        var off = preferenceService.effective(f.userId, f.curriculumId, null);
        assertThat(off.enabled()).isFalse();
        assertThat(off.source()).isEqualTo("CURRICULUM");

        Fixture untouched = fixture();
        assertThat(preferenceService.effective(untouched.userId, untouched.curriculumId, null).enabled())
                .isTrue();
    }

    /** 저장은 갱신이다 — 같은 대상에 두 번 저장해도 행이 늘지 않는다. */
    @Test
    void saving_twice_updates_instead_of_duplicating() {
        Fixture f = fixture();
        preferenceService.save(f.userId, f.curriculumId, null, true, 30);
        preferenceService.save(f.userId, f.curriculumId, null, true, 180);

        assertThat(preferenceService.mine(f.userId, f.curriculumId)).hasSize(1);
        assertThat(preferenceService.effective(f.userId, f.curriculumId, null).leadMinutes()).isEqualTo(180);
    }

    /**
     * 선택지 밖 값은 막는다. 허용하면 예약 표가 그 값을 모르므로 <b>그 사람에게는 알림이 영영 가지
     * 않는다</b> — 설정은 저장됐는데 알림만 안 오는, 가장 알아채기 어려운 고장이다.
     */
    @Test
    void a_lead_time_outside_the_choices_is_rejected() {
        Fixture f = fixture();

        assertThatThrownBy(() -> preferenceService.save(f.userId, f.curriculumId, null, true, 47))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("47");
    }

    // ---- helpers ----

    private record Fixture(UUID userId, UUID curriculumId, UUID lessonId) {
    }

    private Fixture fixture() {
        UUID instructorId = seedUser();
        UUID curriculumId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.curriculum (id, instructor_id, title, lifecycle_status)
                VALUES (?, ?, ?, 'PUBLISHED')
                """, curriculumId, instructorId, "설정 커리큘럼");
        UUID sectionId = UUID.randomUUID();
        jdbc.update("INSERT INTO core.section (id, curriculum_id, title, order_index) VALUES (?, ?, ?, 0)",
                sectionId, curriculumId, "섹션");
        UUID lessonId = UUID.randomUUID();
        jdbc.update("INSERT INTO core.lesson (id, section_id, title, order_index) VALUES (?, ?, ?, 0)",
                lessonId, sectionId, "강의");
        return new Fixture(seedUser(), curriculumId, lessonId);
    }

    private UUID seedUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role, status)
                VALUES (?, ?, 'x', ?, 'STUDENT', 'ACTIVE')
                """, id, "pref-" + id + "@liveclass.test", "테스터");
        return id;
    }
}
