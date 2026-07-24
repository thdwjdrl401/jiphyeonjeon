package com.liveclass.auth;

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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 강사 공개 프로필·비밀번호 변경 계약 (ADR-0031).
 *
 * <p>프로필 이미지(전원 공통)와 달리 공개 프로필(bio·expertise)은 강사 전용이다 — 카탈로그 강사
 * 소개에 노출되는 값이라 학생에겐 개념이 없다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AccountProfileContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void instructor_profile_starts_empty_then_upserts() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");

        // 가입 시 프로필 행을 만들지 않으므로 처음엔 빈 값.
        write(get("/api/me/instructor-profile"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bio").doesNotExist())
                .andExpect(jsonPath("$.expertise").isArray())
                .andExpect(jsonPath("$.expertise.length()").value(0));

        // 첫 저장이 곧 생성(upsert).
        write(put("/api/me/instructor-profile"), instructor, """
                {"bio":"10년차 백엔드 강사","expertise":["Spring Boot","JPA","테스트"]}
                """)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bio").value("10년차 백엔드 강사"))
                .andExpect(jsonPath("$.expertise[0]").value("Spring Boot"))
                .andExpect(jsonPath("$.expertise.length()").value(3));

        // 다시 읽으면 저장된 값.
        write(get("/api/me/instructor-profile"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bio").value("10년차 백엔드 강사"));

        // 다시 저장하면 덮어쓴다(중복 생성 아님).
        write(put("/api/me/instructor-profile"), instructor, """
                {"bio":"수정한 소개","expertise":["Kotlin"]}
                """)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bio").value("수정한 소개"))
                .andExpect(jsonPath("$.expertise.length()").value(1));
    }

    @Test
    void student_cannot_access_instructor_profile() throws Exception {
        Cookie[] student = loginAs("STUDENT");

        write(get("/api/me/instructor-profile"), student, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("AUTH_INSTRUCTOR_ONLY"));
        write(put("/api/me/instructor-profile"), student, """
                {"bio":"학생","expertise":[]}
                """)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("AUTH_INSTRUCTOR_ONLY"));
    }

    @Test
    void too_many_expertise_tags_are_rejected_400() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");

        // 11개 → 상한(10) 초과.
        String tags = "\"" + String.join("\",\"", java.util.Collections.nCopies(11, "태그")) + "\"";
        write(put("/api/me/instructor-profile"), instructor, "{\"bio\":\"\",\"expertise\":[" + tags + "]}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    @Test
    void change_password_then_login_with_new_password() throws Exception {
        String email = "pw-" + UUID.randomUUID() + "@liveclass.test";
        Cookie[] user = signupAndLogin(email, "password123");

        write(put("/api/me/password"), user, """
                {"currentPassword":"password123","newPassword":"newpassword456"}
                """)
                .andExpect(status().isNoContent());

        // 옛 비번은 거절, 새 비번은 통과.
        login(email, "password123").andExpect(status().isUnauthorized());
        login(email, "newpassword456").andExpect(status().isOk());
    }

    @Test
    void change_password_with_wrong_current_returns_401() throws Exception {
        Cookie[] user = signupAndLogin("wrongpw-" + UUID.randomUUID() + "@liveclass.test", "password123");

        write(put("/api/me/password"), user, """
                {"currentPassword":"totally-wrong","newPassword":"newpassword456"}
                """)
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_PASSWORD_MISMATCH"));
    }

    @Test
    void short_new_password_is_rejected_400() throws Exception {
        Cookie[] user = signupAndLogin("shortpw-" + UUID.randomUUID() + "@liveclass.test", "password123");

        write(put("/api/me/password"), user, """
                {"currentPassword":"password123","newPassword":"short"}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));
    }

    // ---- 헬퍼 ----

    private Cookie[] signupAndLogin(String email, String password) throws Exception {
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"%s","displayName":"테스터","role":"STUDENT"}
                """.formatted(email, password)).andExpect(status().isCreated());
        return login(email, password).andReturn().getResponse().getCookies();
    }

    private ResultActions login(String email, String password) throws Exception {
        return write(post("/api/auth/login"), null, """
                {"email":"%s","password":"%s"}
                """.formatted(email, password));
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
        builder = builder.cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder = builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "acc-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        return login(email, "password123").andExpect(status().isOk()).andReturn().getResponse().getCookies();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
