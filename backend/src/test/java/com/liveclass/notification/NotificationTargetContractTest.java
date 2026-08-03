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

    private void seedEnrollment(UUID curriculumId, UUID userId, String status) {
        jdbc.update("""
                INSERT INTO core.enrollment (id, curriculum_id, user_id, status, requested_at)
                VALUES (?, ?, ?, ?, now())
                """, UUID.randomUUID(), curriculumId, userId, status);
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
