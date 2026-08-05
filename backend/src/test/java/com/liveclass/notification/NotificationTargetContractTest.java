package com.liveclass.notification;

import com.liveclass.notification.api.NewNotification;
import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.service.NotificationService;
import jakarta.persistence.EntityManager;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static com.liveclass.notification.domain.NotificationStatus.ACTION_REQUIRED;
import static com.liveclass.notification.domain.NotificationStatus.INFO;
import static com.liveclass.notification.domain.NotificationStatus.NORMAL;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 알림 클릭 대상의 재판정(CONTRACT §2-4, ADR-0073 §8).
 *
 * <p>지키려는 것은 넷이다 — <b>사라진 대상이 200 GONE인가</b>(404가 아니라), <b>이유가 구별되는가</b>,
 * <b>갈 곳 없는 알림의 처리 축이 내려가는가</b>, <b>거절 알림이 자기 자신 때문에 막히지 않는가</b>.
 *
 * <p>세 번째가 중요하다. 갈 곳이 없어졌는데 {@code ACTION_REQUIRED}로 남으면 강사의 처리 대기
 * 목록에 <b>아무리 눌러도 처리되지 않는 항목</b>이 영원히 남는다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class NotificationTargetContractTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private NotificationService notificationService;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private EntityManager entityManager;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void a_live_curriculum_resolves_to_available_with_the_ids_the_screen_needs() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID student = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        seedEnrollment(curriculum, student, "ACTIVE");
        UUID id = seedNotification(student, NotificationTypes.MATERIAL_PUBLISHED, INFO,
                "{\"curriculumId\":\"%s\"}".formatted(curriculum));

        target(student, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("AVAILABLE"))
                .andExpect(jsonPath("$.curriculumId").doesNotExist())
                .andExpect(jsonPath("$.state.curriculumId").value(curriculum.toString()))
                .andExpect(jsonPath("$.reasonCode").doesNotExist());
    }

    /** 삭제는 <b>정상 200</b>이다. 404로 주면 화면이 서버 장애와 구별하지 못한다. */
    @Test
    void a_deleted_curriculum_is_gone_with_two_hundred_not_four_oh_four() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID student = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        seedEnrollment(curriculum, student, "ACTIVE");
        UUID id = seedNotification(student, NotificationTypes.MATERIAL_PUBLISHED, INFO,
                "{\"curriculumId\":\"%s\"}".formatted(curriculum));
        jdbc.update("DELETE FROM core.curriculum WHERE id = ?", curriculum);

        target(student, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("GONE"))
                .andExpect(jsonPath("$.reasonCode").value("TARGET_DELETED"));
    }

    /** 수강을 취소하면 볼 수 없다. 삭제와 <b>다른 이유</b>여야 화면이 다른 문구를 낸다. */
    @Test
    void losing_enrollment_is_access_revoked_not_deleted() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID student = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        seedEnrollment(curriculum, student, "CANCELLED");
        UUID id = seedNotification(student, NotificationTypes.MATERIAL_PUBLISHED, INFO,
                "{\"curriculumId\":\"%s\"}".formatted(curriculum));

        target(student, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("GONE"))
                .andExpect(jsonPath("$.reasonCode").value("ACCESS_REVOKED"));
    }

    /**
     * <b>거절 알림이 자기 자신 때문에 막히면 안 된다.</b> 거절당한 학생은 정의상 수강 중이 아니라,
     * 전부 "수강 중이어야 한다"로 두면 "신청이 거절되었습니다"를 눌렀을 때 "더 이상 볼 수 없습니다"가
     * 뜬다. 받는 사람이 볼 자격이 있어서 보낸 알림인데 그 자격을 다시 부정하는 꼴이다.
     */
    @Test
    void a_rejection_notice_still_opens_the_public_curriculum() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID student = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        seedEnrollment(curriculum, student, "REJECTED");
        UUID id = seedNotification(student, NotificationTypes.ENROLLMENT_REJECTED, INFO,
                "{\"curriculumId\":\"%s\"}".formatted(curriculum));

        target(student, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("AVAILABLE"));
    }

    /** 강사 알림은 소유권을 본다. 남의 커리큘럼 알림은 열리지 않는다. */
    @Test
    void an_instructor_notice_needs_ownership() throws Exception {
        UUID owner = seedUser("INSTRUCTOR");
        UUID otherInstructor = seedUser("INSTRUCTOR");
        UUID curriculum = seedCurriculum(owner, "PUBLISHED");
        UUID id = seedNotification(otherInstructor, NotificationTypes.ENROLLMENT_REQUESTED, ACTION_REQUIRED,
                "{\"curriculumId\":\"%s\"}".formatted(curriculum));

        target(otherInstructor, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("GONE"))
                .andExpect(jsonPath("$.reasonCode").value("ACCESS_REVOKED"));
    }

    /**
     * 갈 곳이 없어진 알림은 처리 대기로 남을 수 없다 — 아무리 눌러도 처리되지 않는 항목이
     * 강사의 목록에 영원히 남는다. <b>읽음 축은 건드리지 않는다.</b>
     */
    @Test
    void a_gone_target_expires_the_action_axis_but_not_the_read_axis() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        UUID id = seedNotification(instructor, NotificationTypes.ENROLLMENT_REQUESTED, ACTION_REQUIRED,
                "{\"curriculumId\":\"%s\"}".formatted(curriculum));
        jdbc.update("DELETE FROM core.curriculum WHERE id = ?", curriculum);

        target(instructor, id).andExpect(jsonPath("$.status").value("GONE"));

        /*
         * 플러시를 강제한다. 테스트와 요청이 같은 트랜잭션이라 엔티티는 더티 상태로만 남아 있고,
         * JdbcTemplate은 영속성 컨텍스트를 우회해 읽는다 — 여기서 flush 하지 않으면 UPDATE가
         * 실제로 나가는지가 아니라 "아직 안 나갔다"를 보게 된다.
         */
        entityManager.flush();

        String actionStatus = jdbc.queryForObject(
                "SELECT action_status FROM core.notification WHERE id = ?", String.class, id);
        String readStatus = jdbc.queryForObject(
                "SELECT read_status FROM core.notification WHERE id = ?", String.class, id);
        org.assertj.core.api.Assertions.assertThat(actionStatus).isEqualTo("EXPIRED");
        org.assertj.core.api.Assertions.assertThat(readStatus)
                .as("읽음 축은 그대로다 — 누른 것과 읽은 것은 다른 축이다")
                .isEqualTo("UNREAD");
    }

    /** 남의 알림은 <b>403이 아니라 404</b>다. 403은 그 알림이 존재한다는 사실을 흘린다. */
    @Test
    void someone_elses_notification_is_404_not_403() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID otherUser = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        UUID id = seedNotification(instructor, NotificationTypes.ENROLLMENT_REQUESTED, ACTION_REQUIRED,
                "{\"curriculumId\":\"%s\"}".formatted(curriculum));

        target(otherUser, id).andExpect(status().isNotFound());
    }

    /**
     * <b>이미 처리한 신청은 눌렀을 때 처리 대기에서 내려온다.</b>
     *
     * <p>정리의 정규 경로는 승인·거절 사건을 받은 워커다. 이건 그 경로가 어긋났을 때의 자가 복구라,
     * 여기서는 사건 없이 수강 상태만 ACTIVE로 두고 확인한다 — 운영에 이미 그런 알림이 쌓여 있다.
     *
     * <p><b>갈 곳은 막지 않는다.</b> 승인된 신청도 수강생 목록에서 확인할 이유가 있다.
     */
    @Test
    void clicking_an_already_handled_request_settles_it_but_still_opens() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID student = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        UUID enrollment = seedEnrollment(curriculum, student, "ACTIVE");
        UUID id = seedNotification(instructor, NotificationTypes.ENROLLMENT_REQUESTED, ACTION_REQUIRED,
                "{\"curriculumId\":\"%s\",\"enrollmentId\":\"%s\"}".formatted(curriculum, enrollment));

        target(instructor, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("AVAILABLE"));

        org.assertj.core.api.Assertions.assertThat(actionStatusOf(id))
                .as("강사가 이미 승인한 신청이다")
                .isEqualTo("COMPLETED");
    }

    /** 학생이 물러 수강 행이 CANCELLED면 <b>완료가 아니라 만료</b>다. 강사는 한 일이 없다. */
    @Test
    void clicking_a_withdrawn_request_expires_it_instead_of_completing_it() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID student = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        UUID enrollment = seedEnrollment(curriculum, student, "CANCELLED");
        UUID id = seedNotification(instructor, NotificationTypes.ENROLLMENT_REQUESTED, ACTION_REQUIRED,
                "{\"curriculumId\":\"%s\",\"enrollmentId\":\"%s\"}".formatted(curriculum, enrollment));

        target(instructor, id).andExpect(jsonPath("$.status").value("AVAILABLE"));

        org.assertj.core.api.Assertions.assertThat(actionStatusOf(id)).isEqualTo("EXPIRED");
    }

    /** 아직 대기 중인 신청은 눌러도 그대로 남는다 — 강사가 처리해야 할 일이 사라지면 안 된다. */
    @Test
    void clicking_a_still_pending_request_leaves_it_on_the_list() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID student = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        UUID enrollment = seedEnrollment(curriculum, student, "PENDING");
        UUID id = seedNotification(instructor, NotificationTypes.ENROLLMENT_REQUESTED, ACTION_REQUIRED,
                "{\"curriculumId\":\"%s\",\"enrollmentId\":\"%s\"}".formatted(curriculum, enrollment));

        target(instructor, id).andExpect(jsonPath("$.status").value("AVAILABLE"));

        org.assertj.core.api.Assertions.assertThat(actionStatusOf(id)).isEqualTo("ACTION_REQUIRED");
    }

    /**
     * <b>녹화 알림은 강사에게만 간다.</b> 그런데 강사는 자기 커리큘럼에 수강 등록돼 있지 않다 —
     * 접근 판정을 "수강 중이어야 한다"로 두면 받는 사람 본인이 자기 알림에서 막힌다.
     */
    @Test
    void a_recording_notice_opens_for_the_owning_instructor() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        UUID lesson = seedLesson(curriculum);
        UUID session = seedLiveSession(curriculum, lesson, instructor, "ENDED");
        UUID id = seedNotification(instructor, NotificationTypes.RECORDING_READY, INFO,
                "{\"curriculumId\":\"%s\",\"lessonId\":\"%s\",\"liveSessionId\":\"%s\"}"
                        .formatted(curriculum, lesson, session));

        target(instructor, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("AVAILABLE"))
                .andExpect(jsonPath("$.state.lessonId").value(lesson.toString()))
                .andExpect(jsonPath("$.state.liveSessionId").value(session.toString()));
    }

    /**
     * <b>취소 알림은 취소됐다는 이유로 막히면 안 된다.</b> 학생이 받는 것은 "라이브가 취소되었습니다"고,
     * 그 알림의 목적지는 입장 화면이 아니라 일정이 보이는 강의 상세다. 취소를 만료로 보면 취소 알림만
     * 정확히 열리지 않는다.
     */
    @Test
    void a_cancel_notice_opens_the_lesson_instead_of_expiring() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID student = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        seedEnrollment(curriculum, student, "ACTIVE");
        UUID lesson = seedLesson(curriculum);
        seedLiveSession(curriculum, lesson, instructor, "CANCELLED");
        UUID id = seedNotification(student, NotificationTypes.LIVE_CANCELED, INFO,
                "{\"curriculumId\":\"%s\",\"lessonId\":\"%s\"}".formatted(curriculum, lesson));

        target(student, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("AVAILABLE"))
                .andExpect(jsonPath("$.state.sectionId").exists())
                .andExpect(jsonPath("$.state.lessonId").value(lesson.toString()));
    }

    /**
     * 라이브가 취소돼도 그 <b>강의</b>는 남아 있다. 취소 판정을 알림 종류와 무관하게 걸면 같은 강의에
     * 걸린 자료·강의 게시 알림까지 함께 닫힌다 — 자료는 그대로 볼 수 있는데도.
     */
    @Test
    void a_material_notice_survives_a_cancelled_live_on_the_same_lesson() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID student = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        seedEnrollment(curriculum, student, "ACTIVE");
        UUID lesson = seedLesson(curriculum);
        seedLiveSession(curriculum, lesson, instructor, "CANCELLED");
        UUID id = seedNotification(student, NotificationTypes.MATERIAL_PUBLISHED, INFO,
                "{\"curriculumId\":\"%s\",\"lessonId\":\"%s\"}".formatted(curriculum, lesson));

        target(student, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("AVAILABLE"));
    }

    /** 입장을 안내하던 알림은 취소되면 갈 곳이 없다. 여기서만 만료다. */
    @Test
    void an_entry_notice_for_a_cancelled_live_is_expired() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID student = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        seedEnrollment(curriculum, student, "ACTIVE");
        UUID lesson = seedLesson(curriculum);
        seedLiveSession(curriculum, lesson, instructor, "CANCELLED");
        UUID id = seedNotification(student, NotificationTypes.LIVE_STARTING_SOON, INFO,
                "{\"curriculumId\":\"%s\",\"lessonId\":\"%s\"}".formatted(curriculum, lesson));

        target(student, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("GONE"))
                .andExpect(jsonPath("$.reasonCode").value("TARGET_EXPIRED"));
    }

    /** 커리큘럼은 남고 <b>강의만</b> 지워진 경우도 삭제다. 커리큘럼만 보면 살아 있는 대상으로 보인다. */
    @Test
    void a_deleted_lesson_is_gone_even_when_the_curriculum_survives() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID student = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        seedEnrollment(curriculum, student, "ACTIVE");
        UUID lesson = seedLesson(curriculum);
        UUID id = seedNotification(student, NotificationTypes.MATERIAL_PUBLISHED, INFO,
                "{\"curriculumId\":\"%s\",\"lessonId\":\"%s\"}".formatted(curriculum, lesson));
        jdbc.update("DELETE FROM core.lesson WHERE id = ?", lesson);

        target(student, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("GONE"))
                .andExpect(jsonPath("$.reasonCode").value("TARGET_DELETED"));
    }

    /**
     * <b>공개했다가 내린 다시보기.</b> 그냥 보내면 재생 API가 404를 주고 화면에는 "다시보기를 불러오지
     * 못했습니다"만 남는다 — 서버 장애와 구별되지 않는다. 여기서 이유를 준다.
     */
    @Test
    void a_withdrawn_replay_is_gone_for_the_student() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID student = seedUser("STUDENT");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        seedEnrollment(curriculum, student, "ACTIVE");
        UUID lesson = seedLesson(curriculum);
        UUID session = seedLiveSession(curriculum, lesson, instructor, "ENDED");
        seedVideoAsset(lesson, session, "WITHDRAWN");
        UUID id = seedNotification(student, NotificationTypes.VOD_PUBLISHED, INFO,
                "{\"curriculumId\":\"%s\",\"lessonId\":\"%s\"}".formatted(curriculum, lesson));

        target(student, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("GONE"))
                .andExpect(jsonPath("$.reasonCode").value("TARGET_DELETED"));
    }

    /** 강사는 막지 않는다 — 철회한 다시보기를 다시 게시하는 자리가 바로 그 화면이다. */
    @Test
    void a_withdrawn_replay_still_opens_for_the_owning_instructor() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        UUID lesson = seedLesson(curriculum);
        UUID session = seedLiveSession(curriculum, lesson, instructor, "ENDED");
        seedVideoAsset(lesson, session, "WITHDRAWN");
        UUID id = seedNotification(instructor, NotificationTypes.VOD_PUBLISHED, INFO,
                "{\"curriculumId\":\"%s\",\"lessonId\":\"%s\"}".formatted(curriculum, lesson));

        target(instructor, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("AVAILABLE"))
                .andExpect(jsonPath("$.state.replayStatus").value("WITHDRAWN"));
    }

    /**
     * <b>업로드 강의는 상세 화면이 따로 있다.</b> 화면이 그것을 알려면 전달 방식이 상태에 실려야 한다 —
     * 없으면 라이브 강의 경로로만 보내게 된다.
     */
    @Test
    void the_state_carries_the_delivery_type_so_uploaded_lessons_get_their_own_screen() throws Exception {
        UUID instructor = seedUser("INSTRUCTOR");
        UUID curriculum = seedCurriculum(instructor, "PUBLISHED");
        UUID lesson = seedRecordedLesson(curriculum);
        UUID id = seedNotification(instructor, NotificationTypes.MATERIAL_PUBLISHED, INFO,
                "{\"curriculumId\":\"%s\",\"lessonId\":\"%s\"}".formatted(curriculum, lesson));

        target(instructor, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("AVAILABLE"))
                .andExpect(jsonPath("$.state.deliveryType").value("RECORDED"));
    }

    /** 저장된 targets가 깨져 있어도 500이 아니다 — 대상이 없는 것과 같이 본다. */
    @Test
    void a_broken_targets_payload_is_gone_not_a_server_error() throws Exception {
        UUID student = seedUser("STUDENT");
        UUID id = seedNotification(student, NotificationTypes.MATERIAL_PUBLISHED, INFO, "{}");

        target(student, id)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("GONE"))
                .andExpect(jsonPath("$.reasonCode").value("TARGET_DELETED"));
    }

    // ---- helpers ----

    private ResultActions target(UUID viewerId, UUID notificationId) throws Exception {
        return mockMvc.perform(get("/api/me/notifications/" + notificationId + "/target")
                .cookie(loginCookiesFor(viewerId)));
    }

    /**
     * 시드로 만든 사용자로 로그인한다. 알림 재판정은 <b>누가 눌렀는가</b>가 전부라, 실제 인증 경로를
     * 태우지 않으면 그 축이 검증되지 않는다.
     */
    private Cookie[] loginCookiesFor(UUID userId) throws Exception {
        String email = jdbc.queryForObject("SELECT email FROM core.app_user WHERE id = ?", String.class, userId);
        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn();
        return login.getResponse().getCookies();
    }

    private UUID seedNotification(UUID recipientId, String type, String actionStatus, String targetsJson) {
        notificationService.create(List.of(new NewNotification(
                recipientId, type, actionStatus, NORMAL, "제목", "내용", targetsJson,
                type + ":group", type + ':' + recipientId + ':' + UUID.randomUUID(), null, null)));
        return jdbc.queryForObject("""
                SELECT id FROM core.notification WHERE recipient_id = ?
                ORDER BY created_at DESC LIMIT 1
                """, UUID.class, recipientId);
    }

    /** 비밀번호는 실제 가입 경로로 만들어야 로그인할 수 있으므로 회원가입 API를 쓴다. */
    private UUID seedUser(String role) throws Exception {
        String email = "tgt-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        return jdbc.queryForObject("SELECT id FROM core.app_user WHERE email = ?", UUID.class, email);
    }

    private UUID seedCurriculum(UUID instructorId, String lifecycle) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.curriculum (id, instructor_id, title, lifecycle_status)
                VALUES (?, ?, ?, ?)
                """, id, instructorId, "재판정 대상", lifecycle);
        return id;
    }

    /** 섹션·레슨을 함께 만든다. 알림 목적지는 섹션 id까지 있어야 강의 상세 경로가 만들어진다. */
    private UUID seedLesson(UUID curriculumId) {
        UUID sectionId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.section (id, curriculum_id, title, order_index)
                VALUES (?, ?, ?, 1)
                """, sectionId, curriculumId, "재판정 섹션");
        UUID lessonId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.lesson (id, section_id, title, order_index, status)
                VALUES (?, ?, ?, 1, 'PUBLISHED')
                """, lessonId, sectionId, "재판정 강의");
        return lessonId;
    }

    /** 업로드 강의. `delivery_type`은 생성 뒤 바꿀 수 없으므로(V31 트리거) 처음부터 RECORDED로 넣는다. */
    private UUID seedRecordedLesson(UUID curriculumId) {
        UUID sectionId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.section (id, curriculum_id, title, order_index)
                VALUES (?, ?, ?, 1)
                """, sectionId, curriculumId, "업로드 섹션");
        UUID lessonId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.lesson (id, section_id, title, order_index, status, delivery_type)
                VALUES (?, ?, ?, 1, 'PUBLISHED', 'RECORDED')
                """, lessonId, sectionId, "업로드 강의");
        return lessonId;
    }

    private void seedVideoAsset(UUID lessonId, UUID liveSessionId, String replayStatus) {
        jdbc.update("""
                INSERT INTO core.video_asset (id, live_session_id, lesson_id, status, replay_status)
                VALUES (?, ?, ?, 'READY', ?)
                """, UUID.randomUUID(), liveSessionId, lessonId, replayStatus);
    }

    private UUID seedLiveSession(UUID curriculumId, UUID lessonId, UUID instructorId, String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.live_session (id, lesson_id, curriculum_id, instructor_id, status, scheduled_at)
                VALUES (?, ?, ?, ?, ?, now())
                """, id, lessonId, curriculumId, instructorId, status);
        return id;
    }

    private UUID seedEnrollment(UUID curriculumId, UUID userId, String status) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.enrollment (id, curriculum_id, user_id, status, requested_at)
                VALUES (?, ?, ?, ?, now())
                """, id, curriculumId, userId, status);
        return id;
    }

    /**
     * 플러시를 강제하고 처리 축을 읽는다. 테스트와 요청이 같은 트랜잭션이라 엔티티는 더티 상태로만
     * 남아 있고, JdbcTemplate은 영속성 컨텍스트를 우회해 읽는다 — flush 없이는 UPDATE가 실제로
     * 나가는지가 아니라 "아직 안 나갔다"를 보게 된다.
     */
    private String actionStatusOf(UUID notificationId) {
        entityManager.flush();
        return jdbc.queryForObject(
                "SELECT action_status FROM core.notification WHERE id = ?", String.class, notificationId);
    }

    private ResultActions write(MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body)
            throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = jsonMapper.readTree(csrf.getResponse().getContentAsString());
        List<Cookie> cookies = new ArrayList<>();
        cookies.add(csrf.getResponse().getCookie("XSRF-TOKEN"));
        if (authCookies != null) {
            cookies.addAll(List.of(authCookies));
        }
        builder = builder.cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder = builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }
}
