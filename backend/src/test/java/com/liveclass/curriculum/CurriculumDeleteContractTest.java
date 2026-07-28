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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 초안 커리큘럼 삭제 계약(DELETE /api/instructor/curriculums/{id}).
 * FE '내 커리큘럼'의 삭제 버튼이 이 상태코드에 분기하므로 계약 테스트로 고정한다
 * — 204(성공)·409(DRAFT 아님)·403(타인)·404(없음), 그리고 섹션까지 함께 사라지는지.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class CurriculumDeleteContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void deleting_a_draft_returns_204_and_the_curriculum_is_gone() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String id = createCurriculum(auth, "삭제 대상 초안");

        write(delete("/api/instructor/curriculums/" + id), auth, null)
                .andExpect(status().isNoContent());

        read(get("/api/instructor/curriculums/" + id), auth)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CURRICULUM_NOT_FOUND"));
    }

    @Test
    void deleting_a_draft_also_removes_its_sections() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String id = createCurriculum(auth, "섹션 있는 초안");
        write(post("/api/instructor/curriculums/" + id + "/sections"), auth,
                "{\"title\":\"1주차\",\"description\":\"오리엔테이션\"}")
                .andExpect(status().isCreated());

        write(delete("/api/instructor/curriculums/" + id), auth, null)
                .andExpect(status().isNoContent());

        // 섹션 목록은 커리큘럼 소유권을 먼저 보므로, 커리큘럼과 함께 사라졌다면 404다.
        read(get("/api/instructor/curriculums/" + id + "/sections"), auth)
                .andExpect(status().isNotFound());
    }

    @Test
    void deleting_a_published_curriculum_returns_409_state_conflict() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String id = createCurriculum(auth, "공개된 커리큘럼");
        write(post("/api/instructor/curriculums/" + id + "/publish"), auth, null).andExpect(status().isOk());

        write(delete("/api/instructor/curriculums/" + id), auth, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_STATE_CONFLICT"));
    }

    @Test
    void deleting_an_archived_curriculum_returns_409_state_conflict() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String id = createCurriculum(auth, "보관된 커리큘럼");
        write(post("/api/instructor/curriculums/" + id + "/publish"), auth, null).andExpect(status().isOk());
        write(post("/api/instructor/curriculums/" + id + "/archive"), auth, null).andExpect(status().isOk());

        write(delete("/api/instructor/curriculums/" + id), auth, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_STATE_CONFLICT"));
    }

    @Test
    void other_instructor_cannot_delete_my_draft_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String id = createCurriculum(owner, "내 초안");

        Cookie[] intruder = loginAs("INSTRUCTOR");
        write(delete("/api/instructor/curriculums/" + id), intruder, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CURRICULUM_FORBIDDEN"));
    }

    @Test
    void deleting_an_unknown_curriculum_returns_404() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");

        write(delete("/api/instructor/curriculums/" + UUID.randomUUID()), auth, null)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CURRICULUM_NOT_FOUND"));
    }

    // ---- 헬퍼 (기존 계약 테스트와 동일 패턴) ----

    private String createCurriculum(Cookie[] auth, String title) throws Exception {
        MvcResult result = write(post("/api/instructor/curriculums"), auth,
                "{\"title\":\"" + title + "\"}")
                .andExpect(status().isCreated())
                .andReturn();
        return json(result).get("curriculumId").asString();
    }

    private org.springframework.test.web.servlet.ResultActions read(
            MockHttpServletRequestBuilder builder, Cookie[] authCookies) throws Exception {
        return mockMvc.perform(builder.cookie(authCookies));
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
        String email = "del-" + UUID.randomUUID() + "@liveclass.test";
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
