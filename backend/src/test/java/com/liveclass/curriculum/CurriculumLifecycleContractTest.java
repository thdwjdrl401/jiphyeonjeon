package com.liveclass.curriculum;

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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 발행/보관 lifecycle 계약 검증 + 발행이 실제로 카탈로그 노출로 이어지는지(핵심 갭 해소).
 * 상태값·에러코드(CURRICULUM_STATE_CONFLICT)·command endpoint 분리는 FE 명세와 일치시킨다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class CurriculumLifecycleContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void publish_moves_draft_to_published_and_sets_publishedAt() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String id = createPublishableCurriculum(auth, "발행 대상");
        write(post("/api/instructor/curriculums/" + id + "/publish"), auth, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lifecycleStatus").value("PUBLISHED"))
                .andExpect(jsonPath("$.publishedAt").exists());
    }

    @Test
    void publishing_already_published_returns_409_state_conflict() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String id = createPublishableCurriculum(auth, "중복 발행");
        write(post("/api/instructor/curriculums/" + id + "/publish"), auth, null).andExpect(status().isOk());

        write(post("/api/instructor/curriculums/" + id + "/publish"), auth, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_STATE_CONFLICT"));
    }

    @Test
    void archive_moves_published_to_archived() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String id = createPublishableCurriculum(auth, "보관 대상");
        write(post("/api/instructor/curriculums/" + id + "/publish"), auth, null).andExpect(status().isOk());

        write(post("/api/instructor/curriculums/" + id + "/archive"), auth, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lifecycleStatus").value("ARCHIVED"));
    }

    @Test
    void archiving_a_draft_returns_409() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String id = createCurriculum(auth, "초안 보관 시도");

        write(post("/api/instructor/curriculums/" + id + "/archive"), auth, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_STATE_CONFLICT"));
    }

    @Test
    void other_instructor_cannot_publish_my_curriculum_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String id = createCurriculum(owner, "내 것");

        Cookie[] intruder = loginAs("INSTRUCTOR");
        write(post("/api/instructor/curriculums/" + id + "/publish"), intruder, null)
                .andExpect(status().isForbidden());
    }

    // ---- 핵심: 발행하면 공개 카탈로그에 뜬다 ----

    @Test
    void published_curriculum_appears_in_public_catalog_draft_does_not() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String title = "카탈로그 노출 " + UUID.randomUUID();
        String id = createCurriculum(auth, title);
        createLesson(auth, createSection(auth, id));   // 게시 선행 조건(ADR-0006)

        // 발행 전엔 카탈로그에 없다.
        mockMvc.perform(get("/api/curriculums").param("q", title))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));

        write(post("/api/instructor/curriculums/" + id + "/publish"), auth, null).andExpect(status().isOk());

        // 발행 후엔 비로그인 카탈로그에 뜬다.
        mockMvc.perform(get("/api/curriculums").param("q", title))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].title").value(title));

        // 상세도 열린다.
        mockMvc.perform(get("/api/curriculums/" + id))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lifecycleStatus").value("PUBLISHED"));

        // 보관하면 다시 사라진다.
        write(post("/api/instructor/curriculums/" + id + "/archive"), auth, null).andExpect(status().isOk());
        mockMvc.perform(get("/api/curriculums").param("q", title))
                .andExpect(jsonPath("$.totalElements").value(0));
        mockMvc.perform(get("/api/curriculums/" + id))
                .andExpect(status().isNotFound());
    }

    // ---- 헬퍼 (기존 계약 테스트와 동일 패턴) ----

    /**
     * 게시 가능한 커리큘럼 = 커리큘럼 + 섹션 1개 + 강의 1개(ADR-0006).
     * 게시 선행 조건이 생겨서, 발행 자체를 검증하는 테스트는 조건을 미리 채워 둬야 한다.
     */
    // ── 게시 선행 조건(ADR-0006): 섹션 1개 이상 AND 커리큘럼 전체 강의 1개 이상 ──
    // FE도 같은 조건으로 버튼을 잠그지만, 버튼을 우회한 직접 호출을 서버가 막아야 한다.

    @Test
    void publishing_curriculum_without_section_returns_409_with_section_guidance() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String id = createCurriculum(auth, "섹션 없는 커리큘럼");

        write(post("/api/instructor/curriculums/" + id + "/publish"), auth, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_NOT_PUBLISHABLE"))
                .andExpect(jsonPath("$.message").value("커리큘럼을 게시하려면 섹션과 강의를 각각 1개 이상 추가해주세요."));
    }

    @Test
    void publishing_curriculum_with_empty_section_returns_409_with_lesson_guidance() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String id = createCurriculum(auth, "강의 없는 커리큘럼");
        createSection(auth, id);

        // 섹션은 있으나 강의가 없다 — 목차만 있고 내용이 없는 커리큘럼은 공개하지 않는다.
        write(post("/api/instructor/curriculums/" + id + "/publish"), auth, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_NOT_PUBLISHABLE"))
                .andExpect(jsonPath("$.message").value("커리큘럼을 게시하려면 강의를 1개 이상 추가해주세요."));
    }

    @Test
    void lesson_in_any_one_section_is_enough_to_publish() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String id = createCurriculum(auth, "일부 섹션만 채운 커리큘럼");
        String first = createSection(auth, id);
        createSection(auth, id);   // 빈 섹션을 남겨 둔다
        createLesson(auth, first);

        // 조건은 커리큘럼 전체 기준이다 — 섹션마다 강의가 있어야 하는 것이 아니다.
        write(post("/api/instructor/curriculums/" + id + "/publish"), auth, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lifecycleStatus").value("PUBLISHED"));
    }


    private String createPublishableCurriculum(Cookie[] auth, String title) throws Exception {
        String curriculumId = createCurriculum(auth, title);
        String sectionId = createSection(auth, curriculumId);
        createLesson(auth, sectionId);
        return curriculumId;
    }

    private String createSection(Cookie[] auth, String curriculumId) throws Exception {
        return json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth,
                "{\"title\":\"1주차\"}").andExpect(status().isCreated()).andReturn())
                .get("sectionId").asString();
    }

    private String createLesson(Cookie[] auth, String sectionId) throws Exception {
        return json(write(post("/api/instructor/sections/" + sectionId + "/lessons"), auth,
                "{\"title\":\"1강\"}").andExpect(status().isCreated()).andReturn())
                .get("lessonId").asString();
    }

    private String createCurriculum(Cookie[] auth, String title) throws Exception {
        MvcResult result = write(post("/api/instructor/curriculums"), auth,
                "{\"title\":\"" + title + "\"}")
                .andExpect(status().isCreated())
                .andReturn();
        return json(result).get("curriculumId").asString();
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
        String email = "life-" + UUID.randomUUID() + "@liveclass.test";
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
