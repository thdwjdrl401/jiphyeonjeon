package com.liveclass.curriculum;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 카탈로그가 "보는 사람 기준"으로 답하는지 검증한다 (CURRICULUM-DETAIL viewerContext·수강정책·레슨 접근).
 *
 * <p>FE는 이 응답만으로 주 CTA와 학습 동선을 정한다. 값이 비면 화면이 전부 잠긴 것처럼 보이므로,
 * 관계별로 어떤 행동이 열리는지를 실제 로그인 흐름으로 확인한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class CatalogViewerContextContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void guest_sees_login_action_and_enrollment_policy() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);

        mockMvc.perform(get("/api/curriculums/" + cid))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewerContext.relationship").value("GUEST"))
                .andExpect(jsonPath("$.viewerContext.allowedActions[0]").value("LOGIN_TO_ENROLL"))
                .andExpect(jsonPath("$.viewerContext.enrollment").doesNotExist())
                .andExpect(jsonPath("$.enrollmentPolicy.type").value("APPROVAL_REQUIRED"))
                .andExpect(jsonPath("$.enrollmentPolicy.status").value("OPEN"))
                .andExpect(jsonPath("$.materials").isArray());
    }

    @Test
    void owner_instructor_can_manage_and_open_lessons() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        addLesson(instructor, cid, "1강");

        write(get("/api/curriculums/" + cid), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewerContext.relationship").value("OWNER_INSTRUCTOR"))
                .andExpect(jsonPath("$.viewerContext.allowedActions[0]").value("MANAGE_CURRICULUM"))
                .andExpect(jsonPath("$.outline[0].lessons[0].access.allowed").value(true))
                .andExpect(jsonPath("$.outline[0].lessons[0].access.destination").value("LESSON_DETAIL"))
                .andExpect(jsonPath("$.outline[0].lessons[0].replayStatus").value("NOT_READY"));
    }

    /**
     * 목차 레슨의 상태 필드명은 {@code status}다 — 관리 응답(LessonView)과 같은 이름.
     *
     * <p>계약으로 한 번 정한 뒤 다른 작업에서 {@code lessonStatus}로 되돌아간 적이 있다. FE 타입·어댑터·
     * 화면이 모두 {@code status}만 읽으므로 이름이 어긋나면 값이 undefined가 되어 상태 배지와 진입
     * 버튼이 조용히 죽는다. 컴파일로도 기존 테스트로도 안 잡히는 종류라 이름 자체를 여기서 못박는다.
     */
    @Test
    void outline_lesson_status_uses_contract_field_name() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        addLesson(instructor, cid, "1강");

        mockMvc.perform(get("/api/curriculums/" + cid))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outline[0].lessons[0].status").value("PUBLISHED"))
                .andExpect(jsonPath("$.outline[0].lessons[0].lessonStatus").doesNotExist());
    }

    @Test
    void other_instructor_gets_no_actions() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(owner);
        Cookie[] other = loginAs("INSTRUCTOR");

        write(get("/api/curriculums/" + cid), other, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewerContext.relationship").value("NON_OWNER_INSTRUCTOR"))
                .andExpect(jsonPath("$.viewerContext.allowedActions").isEmpty());
    }

    @Test
    void unenrolled_student_can_enroll_but_cannot_open_lessons() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        addLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");

        write(get("/api/curriculums/" + cid), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewerContext.relationship").value("UNENROLLED_STUDENT"))
                .andExpect(jsonPath("$.viewerContext.allowedActions[0]").value("ENROLL"))
                .andExpect(jsonPath("$.outline[0].lessons[0].access.allowed").value(false))
                .andExpect(jsonPath("$.outline[0].lessons[0].access.reasonCode").value("ENROLLMENT_REQUIRED"));
    }

    @Test
    void pending_student_can_cancel_and_sees_enrollment_record() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        Cookie[] student = loginAs("STUDENT");
        write(post("/api/curriculums/" + cid + "/enrollments"), student, null).andExpect(status().isCreated());

        write(get("/api/curriculums/" + cid), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewerContext.relationship").value("PENDING_ENROLLMENT"))
                .andExpect(jsonPath("$.viewerContext.allowedActions[0]").value("CANCEL_ENROLLMENT"))
                .andExpect(jsonPath("$.viewerContext.enrollment.status").value("PENDING"))
                .andExpect(jsonPath("$.viewerContext.enrollment.enrollmentId").exists());
    }

    @Test
    void approved_student_can_open_lessons() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        addLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        write(get("/api/curriculums/" + cid), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewerContext.relationship").value("ENROLLED"))
                .andExpect(jsonPath("$.viewerContext.enrollment.status").value("ACTIVE"))
                .andExpect(jsonPath("$.outline[0].lessons[0].access.allowed").value(true))
                .andExpect(jsonPath("$.outline[0].lessons[0].access.reasonCode").doesNotExist());
    }

    @Test
    void scheduled_live_session_appears_on_outline_lesson() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = addLesson(instructor, cid, "라이브 예정 강의");
        write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), instructor,
                "{\"scheduledAt\":\"2026-08-01T10:00:00+09:00\"}")
                .andExpect(status().isCreated());

        // 라이브가 잡혀 있으면 학생은 레슨을 열었을 때 라이브 쪽으로 가야 한다.
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        write(get("/api/curriculums/" + cid), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outline[0].lessons[0].liveSession.sessionId").exists())
                .andExpect(jsonPath("$.outline[0].lessons[0].liveSession.status").value("SCHEDULED"))
                .andExpect(jsonPath("$.outline[0].lessons[0].scheduledAt").exists())
                .andExpect(jsonPath("$.outline[0].lessons[0].access.destination").value("LIVE_SESSION"));
    }

    @Test
    void list_cards_carry_viewer_context() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        write(get("/api/curriculums").param("q", "수강강좌"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].curriculumId").value(cid))
                .andExpect(jsonPath("$.items[0].viewerContext.relationship").value("ENROLLED"));
    }

    @Test
    void my_enrollments_carry_curriculum_card() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        write(get("/api/me/enrollments"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].status").value("ACTIVE"))
                .andExpect(jsonPath("$[0].curriculum.curriculumId").value(cid))
                .andExpect(jsonPath("$[0].curriculum.title").value("수강강좌"))
                .andExpect(jsonPath("$[0].curriculum.instructor.displayName").exists())
                .andExpect(jsonPath("$[0].curriculum.viewerContext.relationship").value("ENROLLED"));
    }

    // ---- 헬퍼 ----

    private String createPublishedCurriculum(Cookie[] instructor) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"수강강좌\"}")
                .andReturn()).get("curriculumId").asString();
        // 게시 선행 조건(ADR-0006): 섹션·강의가 각각 1개 이상 있어야 발행된다.
        String seedSectionId = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), instructor,
                "{\"title\":\"게시용 섹션\"}").andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
        String seedLessonId = json(write(post("/api/instructor/sections/" + seedSectionId + "/lessons"), instructor,
                "{\"title\":\"게시용 강의\"}").andExpect(status().isCreated()).andReturn()).get("lessonId").asString();
        write(post("/api/instructor/curriculums/" + cid + "/publish"), instructor, null).andExpect(status().isOk());
        // 발행 조건만 채우려고 만든 것이라 지운다 — 이 테스트가 세는 강의·목차 인덱스를 원래대로 둔다.
        write(delete("/api/instructor/lessons/" + seedLessonId), instructor, null)
                .andExpect(status().isNoContent());
        write(delete("/api/instructor/sections/" + seedSectionId), instructor, null)
                .andExpect(status().isNoContent());
        return cid;
    }

    /** 섹션 하나 + 게시된 레슨 하나를 만든다. 공개 목차는 PUBLISHED 레슨만 담기 때문에 게시까지 한다. */
    private String addLesson(Cookie[] instructor, String curriculumId, String title) throws Exception {
        String sectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), instructor,
                "{\"title\":\"1주차\"}").andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sectionId + "/lessons"), instructor,
                "{\"title\":\"%s\"}".formatted(title)).andReturn()).get("lessonId").asString();
        return lessonId;
    }

    private void approveEnrollment(Cookie[] instructor, Cookie[] student, String curriculumId) throws Exception {
        String enrollmentId = json(write(post("/api/curriculums/" + curriculumId + "/enrollments"), student, null)
                .andExpect(status().isCreated()).andReturn()).get("enrollmentId").asString();
        write(post("/api/instructor/curriculums/" + curriculumId + "/enrollments/" + enrollmentId + "/approve"),
                instructor, null).andExpect(status().isOk());
    }

    private ResultActions write(MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body)
            throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = json(csrf);
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

    private Cookie[] loginAs(String role) throws Exception {
        String email = "vc-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn();
        return login.getResponse().getCookies();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
