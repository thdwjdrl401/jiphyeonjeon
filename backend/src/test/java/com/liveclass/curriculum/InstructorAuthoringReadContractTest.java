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
 * 강사 저작(authoring) 화면의 <b>읽기</b> 경로 계약. 여기서 잡으려는 실패는 하나다 — <b>방금 만든 것이
 * 안 보이는 것</b>. 강사 저작은 공개 카탈로그({@code /curriculums/{id}}, PUBLISHED-only)가 아니라
 * 강사 권한 축으로 읽어야, DRAFT 커리큘럼·레슨과 방금 건 라이브 일정이 보인다.
 *
 * <ul>
 *   <li>강사 레슨 조회가 <b>DRAFT</b>여도 라이브 세션을 함께 준다(#5 — 저장은 됐는데 새로고침하면 사라지던 것).
 *   <li>강사 대시보드 요약이 운영 지표를 집계한다(#2 — 예전엔 미구현이라 "준비 중" 배너).
 * </ul>
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class InstructorAuthoringReadContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    // ---- #5: 강사 레슨 조회가 (DRAFT여도) 라이브 세션을 준다 ----

    @Test
    void instructor_lesson_get_includes_live_session_for_unpublished_curriculum() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(instructor);          // DRAFT (발행 안 함)
        String sectionId = createSection(instructor, curriculumId);
        String lessonId = createLesson(instructor, sectionId, "라이브 예정 강의");  // DRAFT
        write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), instructor,
                "{\"scheduledAt\":\"2026-08-01T10:00:00+09:00\"}")
                .andExpect(status().isCreated());

        // 커리큘럼·레슨 모두 DRAFT여도 강사 조회는 방금 만든 세션을 그대로 돌려준다.
        write(get("/api/instructor/lessons/" + lessonId), instructor, null)
                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.liveSession.sessionId").exists())
                .andExpect(jsonPath("$.liveSession.status").value("SCHEDULED"))
                .andExpect(jsonPath("$.liveSession.scheduledAt").exists());
    }

    @Test
    void instructor_lesson_get_has_null_live_session_when_none() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sectionId = createSection(instructor);
        String lessonId = createLesson(instructor, sectionId, "일정 없는 강의");

        write(get("/api/instructor/lessons/" + lessonId), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSession").doesNotExist());
    }

    // ---- #2: 강사 대시보드 요약 ----

    @Test
    void dashboard_summary_aggregates_instructor_operations() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String published = createCurriculum(instructor);
        publishCurriculum(instructor, published);
        createCurriculum(instructor);   // DRAFT 하나 더

        // 공개 커리큘럼에 라이브 예정 세션 + 승인된 수강생 하나.
        String sectionId = createSection(instructor, published);
        String lessonId = createLesson(instructor, sectionId, "1강");
        write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), instructor,
                "{\"scheduledAt\":\"2026-08-01T10:00:00+09:00\"}").andExpect(status().isCreated());
        enrollAndApprove(instructor, published);

        write(get("/api/instructor/dashboard-summary"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalCurriculumCount").value(2))
                .andExpect(jsonPath("$.publishedCurriculumCount").value(1))
                .andExpect(jsonPath("$.upcomingLiveCount").value(1))
                .andExpect(jsonPath("$.totalEnrolleeCount").value(1))
                .andExpect(jsonPath("$.todayLiveSession.sessionId").exists())
                .andExpect(jsonPath("$.todayLiveSession.lessonTitle").value("1강"))
                .andExpect(jsonPath("$.todayLiveSession.curriculumTitle").exists());
    }

    @Test
    void dashboard_summary_is_empty_for_instructor_without_curriculums() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        write(get("/api/instructor/dashboard-summary"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalCurriculumCount").value(0))
                .andExpect(jsonPath("$.todayLiveSession").doesNotExist());
    }

    @Test
    void dashboard_summary_requires_instructor_role() throws Exception {
        Cookie[] student = loginAs("STUDENT");
        write(get("/api/instructor/dashboard-summary"), student, null)
                .andExpect(status().isForbidden());
    }

    // ---- 헬퍼 ----

    private String createCurriculum(Cookie[] auth) throws Exception {
        return json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"저작 읽기 테스트\"}")
                .andExpect(status().isCreated()).andReturn()).get("curriculumId").asString();
    }

    private void publishCurriculum(Cookie[] auth, String curriculumId) throws Exception {
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), auth, null).andExpect(status().isOk());
    }

    private String createSection(Cookie[] auth) throws Exception {
        return createSection(auth, createCurriculum(auth));
    }

    private String createSection(Cookie[] auth, String curriculumId) throws Exception {
        return json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth, "{\"title\":\"섹션\"}")
                .andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
    }

    private String createLesson(Cookie[] auth, String sectionId, String title) throws Exception {
        return json(write(post("/api/instructor/sections/" + sectionId + "/lessons"), auth,
                "{\"title\":\"" + title + "\"}").andExpect(status().isCreated()).andReturn()).get("lessonId").asString();
    }

    private void enrollAndApprove(Cookie[] instructor, String curriculumId) throws Exception {
        Cookie[] student = loginAs("STUDENT");
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
        String email = "authoring-" + UUID.randomUUID() + "@liveclass.test";
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
