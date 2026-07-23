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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 수강생용 레슨 상세 {@code GET /api/lessons/{lessonId}} 계약.
 *
 * <p>FE는 목차에서 레슨을 눌러 이 경로로 들어온다. 강사용 {@code /api/instructor/lessons/{id}}는
 * 소유권으로 열리지만 이쪽은 <b>수강 관계</b>로 열린다 — 그 게이트가 목차의 access 판정과 같은
 * 답을 내는지가 이 테스트의 요점이다. 목차에서 "열림"이라 표시해 놓고 실제로 막히면 화면이 어긋난다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class StudentLessonContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void enrolled_student_opens_published_lesson_with_description_and_path() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = publishLesson(instructor, cid, "1강", "세션과 인증의 책임 차이");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        write(get("/api/lessons/" + lessonId), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lessonId").value(lessonId))
                .andExpect(jsonPath("$.title").value("1강"))
                // 목차엔 없고 상세에만 있는 필드 — 이게 이 엔드포인트의 존재 이유다.
                .andExpect(jsonPath("$.description").value("세션과 인증의 책임 차이"))
                .andExpect(jsonPath("$.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.curriculumId").value(cid))
                .andExpect(jsonPath("$.curriculumTitle").value("수강강좌"))
                .andExpect(jsonPath("$.sectionTitle").value("1주차"));
    }

    @Test
    void owner_instructor_can_open_own_unpublished_lesson() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String sectionId = createSection(instructor, cid);
        String lessonId = createLesson(instructor, sectionId, "초안 강의", "");

        // 초안이라 공개 목차엔 없지만, 만든 강사는 열 수 있어야 편집 화면이 뜬다.
        write(get("/api/lessons/" + lessonId), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"));
    }

    @Test
    void unenrolled_student_gets_403_with_enrollment_reason_code() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = publishLesson(instructor, cid, "1강", "설명");
        Cookie[] student = loginAs("STUDENT");

        // 공개 목차가 이미 레슨의 존재를 드러내므로 숨길 것이 없다 — 404가 아니라 403이 맞다.
        // 코드는 목차 access.reasonCode와 같은 값이라 FE가 같은 분기로 수강 동선을 띄운다.
        write(get("/api/lessons/" + lessonId), student, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_REQUIRED"));
    }

    @Test
    void pending_student_cannot_open_lesson_yet() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = publishLesson(instructor, cid, "1강", "설명");
        Cookie[] student = loginAs("STUDENT");
        write(post("/api/curriculums/" + cid + "/enrollments"), student, null).andExpect(status().isCreated());

        write(get("/api/lessons/" + lessonId), student, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_REQUIRED"));
    }

    @Test
    void enrolled_student_gets_404_for_unpublished_lesson() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String sectionId = createSection(instructor, cid);
        String draftId = createLesson(instructor, sectionId, "초안 강의", "");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        // 수강 중이라도 그 사람의 목차엔 없는 레슨이다. 403으로 답하면 초안의 존재가 새어 나간다.
        write(get("/api/lessons/" + draftId), student, null)
                .andExpect(status().isNotFound());
    }

    @Test
    void non_owner_instructor_cannot_open_someone_elses_lesson() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(owner);
        String lessonId = publishLesson(owner, cid, "1강", "설명");
        Cookie[] other = loginAs("INSTRUCTOR");

        write(get("/api/lessons/" + lessonId), other, null)
                .andExpect(status().isForbidden());
    }

    @Test
    void unknown_lesson_returns_404() throws Exception {
        Cookie[] student = loginAs("STUDENT");

        write(get("/api/lessons/" + UUID.randomUUID()), student, null)
                .andExpect(status().isNotFound());
    }

    @Test
    void anonymous_request_returns_401() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = publishLesson(instructor, cid, "1강", "설명");

        mockMvc.perform(get("/api/lessons/" + lessonId))
                .andExpect(status().isUnauthorized());
    }

    // ---- 헬퍼 ----

    private String createPublishedCurriculum(Cookie[] instructor) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"수강강좌\"}")
                .andReturn()).get("curriculumId").asString();
        write(post("/api/instructor/curriculums/" + cid + "/publish"), instructor, null).andExpect(status().isOk());
        return cid;
    }

    private String createSection(Cookie[] instructor, String curriculumId) throws Exception {
        return json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), instructor,
                "{\"title\":\"1주차\"}").andReturn()).get("sectionId").asString();
    }

    private String createLesson(Cookie[] instructor, String sectionId, String title, String description)
            throws Exception {
        return json(write(post("/api/instructor/sections/" + sectionId + "/lessons"), instructor,
                "{\"title\":\"%s\",\"description\":\"%s\"}".formatted(title, description)).andReturn())
                .get("lessonId").asString();
    }

    private String publishLesson(Cookie[] instructor, String curriculumId, String title, String description)
            throws Exception {
        String lessonId = createLesson(instructor, createSection(instructor, curriculumId), title, description);
        write(post("/api/instructor/lessons/" + lessonId + "/publish"), instructor, null).andExpect(status().isOk());
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
        Cookie xsrf = csrf.getResponse().getCookie("XSRF-TOKEN");

        List<Cookie> cookies = new ArrayList<>();
        cookies.add(xsrf);
        if (authCookies != null) {
            cookies.addAll(List.of(authCookies));
        }
        builder = builder
                .cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder = builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "user-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role))
                .andExpect(status().isCreated());
        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email))
                .andExpect(status().isOk())
                .andReturn();
        return login.getResponse().getCookies();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
