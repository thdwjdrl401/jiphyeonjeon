package com.liveclass.enrollment;

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
 * 수강 계약 검증: 승인제 흐름(신청 PENDING → 강사 승인 ACTIVE) + 가드(중복 신청·미발행·비소유 강사).
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class EnrollmentContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void apply_is_pending_then_instructor_approves_to_active() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);

        Cookie[] student = loginAs("STUDENT");
        // 신청 → 승인제라 PENDING
        String eid = json(write(post("/api/curriculums/" + cid + "/enrollments"), student, null)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andReturn()).get("enrollmentId").asString();

        // 강사 대기 목록에 뜬다
        write(get("/api/instructor/curriculums/" + cid + "/enrollments"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].status").value("PENDING"));

        // 강사 승인 → ACTIVE
        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));

        // 학생 내 수강 목록에 ACTIVE로
        write(get("/api/me/enrollments"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].status").value("ACTIVE"));
    }

    @Test
    void double_apply_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        Cookie[] student = loginAs("STUDENT");

        write(post("/api/curriculums/" + cid + "/enrollments"), student, null).andExpect(status().isCreated());
        write(post("/api/curriculums/" + cid + "/enrollments"), student, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_STATE_CONFLICT"));
    }

    @Test
    void apply_to_unpublished_curriculum_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"미발행\"}")
                .andReturn()).get("curriculumId").asString();   // DRAFT 상태(발행 안 함)
        Cookie[] student = loginAs("STUDENT");

        write(post("/api/curriculums/" + cid + "/enrollments"), student, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_STATE_CONFLICT"));
    }

    @Test
    void instructor_role_cannot_apply() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);

        // 강사 계정으로 수강 신청 → STUDENT 역할 아님 → 403(강사 수강 불가)
        write(post("/api/curriculums/" + cid + "/enrollments"), instructor, null)
                .andExpect(status().isForbidden());
    }

    @Test
    void non_owner_instructor_cannot_see_pending() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(owner);
        Cookie[] other = loginAs("INSTRUCTOR");

        write(get("/api/instructor/curriculums/" + cid + "/enrollments"), other, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CURRICULUM_FORBIDDEN"));
    }

    // ---- 헬퍼 ----

    private String createPublishedCurriculum(Cookie[] instructor) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"수강강좌\"}")
                .andReturn()).get("curriculumId").asString();
        write(post("/api/instructor/curriculums/" + cid + "/publish"), instructor, null).andExpect(status().isOk());
        return cid;
    }

    private org.springframework.test.web.servlet.ResultActions write(
            MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body) throws Exception {
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
        String email = "enr-" + UUID.randomUUID() + "@liveclass.test";
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
