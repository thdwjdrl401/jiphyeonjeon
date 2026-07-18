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
 * 강사 커리큘럼 관리 계약 검증 (CONTRACT §2: 201/400/403/404/409, 소유권 검증).
 * 실제 로그인 세션을 써서 인가(ROLE_INSTRUCTOR)와 소유권 판정이 통째로 도는지 확인한다.
 *
 * 세션은 Redis에 저장되므로 MockHttpSession이 아니라 로그인이 준 SESSION 쿠키를 실어 이어간다.
 * CSRF는 쿠키 기반(CookieCsrfTokenRepository)이라 XSRF-TOKEN 쿠키 + 매칭 헤더를 함께 보낸다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class InstructorCurriculumContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private EntityManager entityManager;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    /**
     * 카운터는 DB 트리거가 유지한다. 트리거가 쓴 값을 검증하려면 flush(트리거 발화) 후
     * clear(1차 캐시 비움)로 다음 조회가 DB를 다시 읽게 해야 한다 — 안 그러면 in-memory
     * 캐시 값만 보고 통과해버린다(이 버그를 놓쳤던 원인).
     */
    private void syncWithDatabase() {
        entityManager.flush();
        entityManager.clear();
    }

    // ---- 생성·조회 ----

    @Test
    void instructor_creates_curriculum_returns_201_camelCase() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");

        write(post("/api/instructor/curriculums"), auth, """
                {"title":"실시간 Spring 입문","summary":"라이브 기초"}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.curriculumId").exists())
                .andExpect(jsonPath("$.title").value("실시간 Spring 입문"))
                .andExpect(jsonPath("$.lifecycleStatus").value("DRAFT"))
                .andExpect(jsonPath("$.sectionCount").value(0))
                .andExpect(jsonPath("$.curriculum_id").doesNotExist());
    }

    @Test
    void student_cannot_create_curriculum_returns_403() throws Exception {
        Cookie[] auth = loginAs("STUDENT");

        write(post("/api/instructor/curriculums"), auth, """
                {"title":"막아야 함"}
                """)
                .andExpect(status().isForbidden());
    }

    @Test
    void anonymous_cannot_access_instructor_api_returns_401() throws Exception {
        mockMvc.perform(get("/api/instructor/curriculums"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void create_without_title_returns_400() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");

        write(post("/api/instructor/curriculums"), auth, """
                {"summary":"제목 없음"}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    // ---- 소유권 ----

    @Test
    void other_instructor_cannot_read_my_curriculum_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(owner, "내 것");

        Cookie[] intruder = loginAs("INSTRUCTOR");
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId).cookie(intruder))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CURRICULUM_FORBIDDEN"));
    }

    @Test
    void unknown_curriculum_returns_404() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        mockMvc.perform(get("/api/instructor/curriculums/" + UUID.randomUUID()).cookie(auth))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CURRICULUM_NOT_FOUND"));
    }

    @Test
    void patch_updates_only_given_fields() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "원래 제목");

        write(patch("/api/instructor/curriculums/" + curriculumId), auth, """
                {"summary":"소개만 변경"}
                """)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.title").value("원래 제목"))
                .andExpect(jsonPath("$.summary").value("소개만 변경"));
    }

    @Test
    void patch_updates_period() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "기간 수정");

        write(patch("/api/instructor/curriculums/" + curriculumId), auth, """
                {"startsAt":"2026-08-01T10:00:00+09:00","endsAt":"2026-10-15T22:00:00+09:00"}
                """)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.startsAt").exists())
                .andExpect(jsonPath("$.endsAt").exists());
    }

    // ---- 섹션 ----

    @Test
    void create_section_appends_and_bumps_counters() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "섹션 테스트");

        write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth, """
                {"title":"1주차"}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.orderIndex").value(0));

        write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth, """
                {"title":"2주차"}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.orderIndex").value(1));

        // 트리거가 쓴 section_count를 실제 DB에서 확인한다(캐시 값이 아니라).
        syncWithDatabase();
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId).cookie(auth))
                .andExpect(jsonPath("$.sectionCount").value(2))
                .andExpect(jsonPath("$.structureVersion").value(2));
    }

    @Test
    void delete_empty_section_returns_204() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "삭제 테스트");
        String sectionId = createSection(auth, curriculumId, "지울 섹션");

        write(delete("/api/instructor/sections/" + sectionId), auth, null)
                .andExpect(status().isNoContent());

        // 트리거가 −1 하므로 0이어야 한다. 앱이 이중 감소하면 −1로 드러난다(회귀 방지).
        syncWithDatabase();
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId).cookie(auth))
                .andExpect(jsonPath("$.sectionCount").value(0));
    }

    @Test
    void other_instructor_cannot_delete_my_section_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(owner, "내 것");
        String sectionId = createSection(owner, curriculumId, "내 섹션");

        Cookie[] intruder = loginAs("INSTRUCTOR");
        write(delete("/api/instructor/sections/" + sectionId), intruder, null)
                .andExpect(status().isForbidden());
    }

    // ---- 헬퍼 ----

    private String createCurriculum(Cookie[] auth, String title) throws Exception {
        MvcResult result = write(post("/api/instructor/curriculums"), auth,
                "{\"title\":\"" + title + "\"}")
                .andExpect(status().isCreated())
                .andReturn();
        return json(result).get("curriculumId").asString();
    }

    private String createSection(Cookie[] auth, String curriculumId, String title) throws Exception {
        MvcResult result = write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth,
                "{\"title\":\"" + title + "\"}")
                .andExpect(status().isCreated())
                .andReturn();
        return json(result).get("sectionId").asString();
    }

    /** 변경 요청: CSRF 핸드셰이크(쿠키+헤더) + 로그인 세션 쿠키를 함께 실어 보낸다. */
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

        builder = builder
                .cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder = builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    /** 고유 이메일로 가입 → 로그인해 SESSION 쿠키를 돌려준다. role은 STUDENT 또는 INSTRUCTOR. */
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
