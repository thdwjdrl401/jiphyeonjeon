package com.liveclass.curriculum;

import jakarta.persistence.EntityManager;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 강사 레슨 CRUD 계약 검증. 데이터는 lesson 모듈, 소유권·오케스트레이션은 curriculum 모듈.
 * lesson_count는 DB 트리거가 유지하므로 flush+clear 후 DB 값을 확인한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class InstructorLessonContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private EntityManager entityManager;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void create_lesson_returns_201_draft_camelCase() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String sectionId = createSection(auth);

        write(post("/api/instructor/sections/" + sectionId + "/lessons"), auth, """
                {"title":"오리엔테이션"}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.lessonId").exists())
                .andExpect(jsonPath("$.sectionId").value(sectionId))
                .andExpect(jsonPath("$.title").value("오리엔테이션"))
                .andExpect(jsonPath("$.status").value("DRAFT"))
                .andExpect(jsonPath("$.order").value(0))
                .andExpect(jsonPath("$.lesson_id").doesNotExist());
    }

    @Test
    void lessons_append_in_order_and_bump_curriculum_lesson_count() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        String sectionId = createSection(auth, curriculumId);

        createLesson(auth, sectionId, "1주차");
        createLesson(auth, sectionId, "2주차");

        // lesson_count는 트리거가 유지 — 실제 DB 값 확인.
        syncWithDatabase();
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId).cookie(auth))
                .andExpect(jsonPath("$.lessonCount").value(2));

        mockMvc.perform(get("/api/instructor/sections/" + sectionId + "/lessons").cookie(auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].order").value(0))
                .andExpect(jsonPath("$[1].order").value(1));
    }

    @Test
    void patch_updates_lesson_fields() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String sectionId = createSection(auth);
        String lessonId = createLesson(auth, sectionId, "원래 제목");

        write(patch("/api/instructor/lessons/" + lessonId), auth, """
                {"description":"설명 추가"}
                """)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("원래 제목"))
                .andExpect(jsonPath("$.description").value("설명 추가"));
    }

    @Test
    void delete_lesson_returns_204_and_drops_count() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        String sectionId = createSection(auth, curriculumId);
        String lessonId = createLesson(auth, sectionId, "지울 레슨");

        write(delete("/api/instructor/lessons/" + lessonId), auth, null)
                .andExpect(status().isNoContent());

        syncWithDatabase();
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId).cookie(auth))
                .andExpect(jsonPath("$.lessonCount").value(0));
    }

    @Test
    void unknown_lesson_returns_404() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        mockMvc.perform(get("/api/instructor/lessons/" + UUID.randomUUID()).cookie(auth))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CURRICULUM_NOT_FOUND"));
    }

    @Test
    void other_instructor_cannot_touch_my_lesson_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String sectionId = createSection(owner);
        String lessonId = createLesson(owner, sectionId, "내 레슨");

        Cookie[] intruder = loginAs("INSTRUCTOR");
        mockMvc.perform(get("/api/instructor/lessons/" + lessonId).cookie(intruder))
                .andExpect(status().isForbidden());
        write(patch("/api/instructor/lessons/" + lessonId), intruder, "{\"title\":\"침입\"}")
                .andExpect(status().isForbidden());
    }

    @Test
    void student_cannot_create_lesson_returns_403() throws Exception {
        // 섹션은 강사가 만들고, 학생이 그 섹션에 레슨 생성 시도 → 역할에서 막힘.
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sectionId = createSection(instructor);

        Cookie[] student = loginAs("STUDENT");
        write(post("/api/instructor/sections/" + sectionId + "/lessons"), student, "{\"title\":\"막힘\"}")
                .andExpect(status().isForbidden());
    }

    // ---- 헬퍼 ----

    private String createCurriculum(Cookie[] auth) throws Exception {
        MvcResult r = write(post("/api/instructor/curriculums"), auth, "{\"title\":\"레슨 테스트\"}")
                .andExpect(status().isCreated()).andReturn();
        return json(r).get("curriculumId").asString();
    }

    private String createSection(Cookie[] auth) throws Exception {
        return createSection(auth, createCurriculum(auth));
    }

    private String createSection(Cookie[] auth, String curriculumId) throws Exception {
        MvcResult r = write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth, "{\"title\":\"섹션\"}")
                .andExpect(status().isCreated()).andReturn();
        return json(r).get("sectionId").asString();
    }

    private String createLesson(Cookie[] auth, String sectionId, String title) throws Exception {
        MvcResult r = write(post("/api/instructor/sections/" + sectionId + "/lessons"), auth,
                "{\"title\":\"" + title + "\"}")
                .andExpect(status().isCreated()).andReturn();
        return json(r).get("lessonId").asString();
    }

    private void syncWithDatabase() {
        entityManager.flush();
        entityManager.clear();
    }

    private org.springframework.test.web.servlet.ResultActions write(
            MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body) throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = json(csrf);
        Cookie xsrf = csrf.getResponse().getCookie("XSRF-TOKEN");
        List<Cookie> cookies = new ArrayList<>();
        cookies.add(xsrf);
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
        String email = "lesson-" + UUID.randomUUID() + "@liveclass.test";
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
