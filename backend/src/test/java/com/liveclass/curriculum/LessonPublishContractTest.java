package com.liveclass.curriculum;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 레슨 발행/게시취소 계약 검증. MVP 직행(DRAFT↔PUBLISHED, ADR-0021). 데이터는 lesson 모듈,
 * 소유권·상태전이 정책은 curriculum 오케스트레이터가 책임진다. 발행이 공개 목차(카탈로그) 노출을
 * 토글하는지까지 end-to-end로 확인한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LessonPublishContractTest {

    @Autowired
    private MockMvc mockMvc;

    // 트리거(trg_lesson_count)가 유지하는 published_lesson_count를 원시 SQL로 읽어 Hibernate 1차 캐시를 우회한다.
    @Autowired
    private JdbcTemplate jdbcTemplate;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void publish_makes_lesson_appear_in_public_catalog_outline() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        publishCurriculum(auth, curriculumId);
        String sectionId = createSection(auth, curriculumId);
        String lessonId = createLesson(auth, sectionId, "발행 대상");

        // DRAFT 레슨은 공개 목차에 없다. (GET가 Hibernate flush를 강제하므로 이후 카운트 조회는 최신값.)
        mockMvc.perform(get("/api/curriculums/" + curriculumId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outline[0].lessons.length()").value(0));
        assertThat(publishedLessonCount(curriculumId)).isZero();   // 발행 전: 트리거 카운터 0

        // 발행 → 200 PUBLISHED.
        write(post("/api/instructor/lessons/" + lessonId + "/publish"), auth, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("PUBLISHED"))
                .andExpect(jsonPath("$.lessonId").value(lessonId));

        // 이제 공개 목차에 노출된다.
        mockMvc.perform(get("/api/curriculums/" + curriculumId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outline[0].lessons.length()").value(1))
                .andExpect(jsonPath("$.outline[0].lessons[0].lessonId").value(lessonId));
        // 트리거(trg_lesson_count) UPDATE 분기가 published_lesson_count를 +1 했는지 잠근다.
        assertThat(publishedLessonCount(curriculumId)).isEqualTo(1);
    }

    @Test
    void unpublish_removes_lesson_from_public_catalog_outline() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        publishCurriculum(auth, curriculumId);
        String sectionId = createSection(auth, curriculumId);
        String lessonId = createLesson(auth, sectionId, "발행했다 내릴 대상");

        write(post("/api/instructor/lessons/" + lessonId + "/publish"), auth, null)
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/curriculums/" + curriculumId))
                .andExpect(jsonPath("$.outline[0].lessons.length()").value(1));

        assertThat(publishedLessonCount(curriculumId)).isEqualTo(1);

        // 게시취소 → 200 DRAFT.
        write(post("/api/instructor/lessons/" + lessonId + "/unpublish"), auth, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("DRAFT"));

        // 목차에서 다시 사라진다.
        mockMvc.perform(get("/api/curriculums/" + curriculumId))
                .andExpect(jsonPath("$.outline[0].lessons.length()").value(0));
        // 트리거 UPDATE 분기가 카운터를 −1 해 원위치했는지 잠근다.
        assertThat(publishedLessonCount(curriculumId)).isZero();
    }

    @Test
    void other_instructor_cannot_publish_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String sectionId = createSection(owner);
        String lessonId = createLesson(owner, sectionId, "내 레슨");

        Cookie[] intruder = loginAs("INSTRUCTOR");
        write(post("/api/instructor/lessons/" + lessonId + "/publish"), intruder, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CURRICULUM_FORBIDDEN"));
    }

    @Test
    void publish_unknown_lesson_returns_404() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        write(post("/api/instructor/lessons/" + UUID.randomUUID() + "/publish"), auth, null)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CURRICULUM_NOT_FOUND"));
    }

    @Test
    void double_publish_returns_409() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String sectionId = createSection(auth);
        String lessonId = createLesson(auth, sectionId, "이미 발행");

        write(post("/api/instructor/lessons/" + lessonId + "/publish"), auth, null)
                .andExpect(status().isOk());
        write(post("/api/instructor/lessons/" + lessonId + "/publish"), auth, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_STATE_CONFLICT"));
    }

    @Test
    void unpublish_draft_lesson_returns_409() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String sectionId = createSection(auth);
        String lessonId = createLesson(auth, sectionId, "초안인데 게시취소");

        write(post("/api/instructor/lessons/" + lessonId + "/unpublish"), auth, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_STATE_CONFLICT"));
    }

    // ---- 헬퍼 (InstructorLessonContractTest와 동일 패턴) ----

    private String createCurriculum(Cookie[] auth) throws Exception {
        MvcResult r = write(post("/api/instructor/curriculums"), auth, "{\"title\":\"발행 테스트\"}")
                .andExpect(status().isCreated()).andReturn();
        return json(r).get("curriculumId").asString();
    }

    private void publishCurriculum(Cookie[] auth, String curriculumId) throws Exception {
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), auth, null)
                .andExpect(status().isOk());
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
        String email = "publish-" + UUID.randomUUID() + "@liveclass.test";
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

    /** 커리큘럼의 트리거 유지 카운터를 DB에서 직접 읽는다(앱 캐시·응답에 안 실리는 값이라 원시 SQL). */
    private int publishedLessonCount(String curriculumId) {
        Integer count = jdbcTemplate.queryForObject(
                "SELECT published_lesson_count FROM core.curriculum WHERE id = ?",
                Integer.class, UUID.fromString(curriculumId));
        return count == null ? -1 : count;
    }
}
