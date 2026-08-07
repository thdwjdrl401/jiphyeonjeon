package com.liveclass.admin;

import com.liveclass.admin.service.SessionDetailService;
import com.liveclass.admin.service.SessionLabelService;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 운영 콘솔의 세션 이름표(ADR-0089).
 *
 * <p>지키려는 것은 셋이다 — <b>강의·커리큘럼 제목이 붙는가</b>, <b>없는 세션이 나머지 행을 죽이지
 * 않는가</b>, <b>물어본 순서와 개수가 그대로 오는가</b>.
 *
 * <p>두 번째가 중요하다. 이 화면이 존재하는 이유가 유령 Egress를 걷어내는 것인데, 유령은 정의상
 * 세션이 이미 사라진 건이다. 그 한 건에 404를 내면 <b>정리해야 할 바로 그 행</b>이 화면에서 사라진다.
 */
@SpringBootTest
@Transactional
class AdminSessionContractTest {

    @Autowired private SessionLabelService service;
    @Autowired private SessionDetailService detailService;
    @Autowired private JdbcTemplate jdbc;

    @Test
    void a_session_carries_its_lesson_and_curriculum_titles() {
        Seed seed = seedLiveSession("자료구조 심화", "3주차 — 트리 순회");

        List<SessionLabelService.SessionLabel> labels = service.labelsFor(List.of(seed.sessionId()));

        assertThat(labels).hasSize(1);
        SessionLabelService.SessionLabel label = labels.getFirst();
        assertThat(label.sessionId()).isEqualTo(seed.sessionId());
        assertThat(label.lessonTitle()).isEqualTo("3주차 — 트리 순회");
        assertThat(label.curriculumTitle()).isEqualTo("자료구조 심화");
        assertThat(label.curriculumId())
                .as("화면이 공개 커리큘럼 페이지로 링크하려면 id가 있어야 한다")
                .isEqualTo(seed.curriculumId());
    }

    /**
     * 유령 Egress가 이 경우다. 행을 빼거나 오류를 내면 정리해야 할 그 행이 화면에서 사라진다.
     */
    @Test
    void an_unknown_session_comes_back_empty_instead_of_failing() {
        Seed seed = seedLiveSession("살아 있는 커리큘럼", "살아 있는 강의");
        UUID ghost = UUID.randomUUID();

        List<SessionLabelService.SessionLabel> labels = service.labelsFor(List.of(ghost, seed.sessionId()));

        assertThat(labels).hasSize(2);
        assertThat(labels.getFirst().sessionId())
                .as("물어본 순서를 지킨다 — 화면이 행을 짝지어야 한다")
                .isEqualTo(ghost);
        assertThat(labels.getFirst().lessonTitle()).isNull();
        assertThat(labels.getFirst().curriculumTitle()).isNull();
        assertThat(labels.get(1).lessonTitle())
                .as("한 건이 없다고 나머지 이름표가 사라지지 않는다")
                .isEqualTo("살아 있는 강의");
    }

    /** 같은 세션이 두 패널에 함께 뜰 수 있다. 중복은 한 번만 조회하고 한 번만 돌려준다. */
    @Test
    void duplicate_ids_are_asked_once() {
        Seed seed = seedLiveSession("커리큘럼", "강의");

        List<SessionLabelService.SessionLabel> labels =
                service.labelsFor(List.of(seed.sessionId(), seed.sessionId()));

        assertThat(labels).hasSize(1);
    }

    @Test
    void nothing_asked_means_nothing_returned() {
        assertThat(service.labelsFor(List.of())).isEmpty();
    }

    /**
     * 운영 상세는 강사 화면을 열어 주는 대신 만든 것이다. 운영자가 판단에 쓰는 값이 한 번에 나와야
     * 한다 — 무슨 강의인지, 무엇을 켜고 시작했는지, 녹화가 어디까지 갔는지.
     */
    @Test
    void the_detail_carries_what_an_operator_judges_with() {
        Seed seed = seedLiveSession("자료구조 심화", "3주차 — 트리 순회");

        SessionDetailService.SessionDetail detail = detailService.findBySessionId(seed.sessionId())
                .orElseThrow();

        assertThat(detail.lessonTitle()).isEqualTo("3주차 — 트리 순회");
        assertThat(detail.curriculumTitle()).isEqualTo("자료구조 심화");
        assertThat(detail.curriculumId()).isEqualTo(seed.curriculumId());
        assertThat(detail.instructorName())
                .as("누구 수업인지는 표시 이름으로 충분하다 — 이메일은 담지 않는다")
                .isEqualTo("강사");
        assertThat(detail.roomName())
                .as("LiveKit 콘솔·로그에서 찾을 때 쓰는 값이다")
                .isEqualTo("session-" + seed.sessionId());
        assertThat(detail.features().recording()).isTrue();
        assertThat(detail.recording())
                .as("녹화 자산이 아직 없는 세션이다 — null이 정상이고 화면이 그렇게 말한다")
                .isNull();
    }

    /** 주소로 직접 들어오는 화면이라 "그런 세션 없음"을 분명히 말해야 한다(목록 이름표와 규칙이 다르다). */
    @Test
    void an_unknown_session_has_no_detail() {
        assertThat(detailService.findBySessionId(UUID.randomUUID())).isEmpty();
    }

    // ---- helpers ----

    private record Seed(UUID sessionId, UUID lessonId, UUID curriculumId) {
    }

    private Seed seedLiveSession(String curriculumTitle, String lessonTitle) {
        UUID instructor = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role)
                VALUES (?, ?, 'x', '강사', 'INSTRUCTOR')
                """, instructor, "label-" + instructor + "@liveclass.test");
        UUID curriculum = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.curriculum (id, instructor_id, title, lifecycle_status)
                VALUES (?, ?, ?, 'PUBLISHED')
                """, curriculum, instructor, curriculumTitle);
        UUID section = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.section (id, curriculum_id, title, order_index) VALUES (?, ?, '섹션', 1)
                """, section, curriculum);
        UUID lesson = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.lesson (id, section_id, title, order_index, status)
                VALUES (?, ?, ?, 1, 'PUBLISHED')
                """, lesson, section, lessonTitle);
        UUID session = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.live_session (id, lesson_id, curriculum_id, instructor_id, status, scheduled_at)
                VALUES (?, ?, ?, ?, 'ENDED', now())
                """, session, lesson, curriculum, instructor);
        return new Seed(session, lesson, curriculum);
    }
}
