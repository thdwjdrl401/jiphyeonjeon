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

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * FE/BE 공유 계약 검증 (CONTRACT §2, POLICY: 로그인은 CP 완료 게이트 핵심 경로).
 * 내부 로직 단위테스트가 아니라 계약 회귀 방지가 목적이다.
 *
 * spring-security-test의 .with(csrf())는 쓰지 않는다 — 그 후처리기는 필터의 CsrfTokenRepository를
 * 컨텍스트 전역에서 갈아끼워 우리 쿠키 기반 설정(ADR-0014)을 지워버린다.
 * 대신 프론트가 실제로 하는 핸드셰이크(GET /csrf → 쿠키+헤더 에코)를 그대로 재현한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AuthContractTest {

    @Autowired
    private MockMvc mockMvc;

    // ---- 계약 검증 ----

    @Test
    void signup_returns_201_and_camelCase_user() throws Exception {
        signup("new-student@liveclass.test", "password123")
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.userId").exists())
                .andExpect(jsonPath("$.email").value("new-student@liveclass.test"))
                .andExpect(jsonPath("$.displayName").value("김학생"))
                .andExpect(jsonPath("$.role").value("STUDENT"))
                // snake_case 유출 금지 (CONTRACT §1)
                .andExpect(jsonPath("$.user_id").doesNotExist())
                .andExpect(jsonPath("$.display_name").doesNotExist());
    }

    @Test
    void signup_with_duplicate_email_returns_409_with_stable_code() throws Exception {
        signup("dup@liveclass.test", "password123").andExpect(status().isCreated());

        signup("dup@liveclass.test", "password456")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("AUTH_EMAIL_DUPLICATED"));
    }

    @Test
    void signup_normalizes_email_case_so_duplicates_are_rejected() throws Exception {
        signup("Mixed.Case@liveclass.test", "password123").andExpect(status().isCreated());

        signup("MIXED.CASE@liveclass.test", "password123")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("AUTH_EMAIL_DUPLICATED"));
    }

    @Test
    void login_with_wrong_password_returns_401_with_stable_code() throws Exception {
        signup("wrongpw@liveclass.test", "password123").andExpect(status().isCreated());

        login("wrongpw@liveclass.test", "not-the-password")
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_INVALID_CREDENTIALS"));
    }

    @Test
    void login_with_unknown_email_returns_401_indistinguishable_from_wrong_password() throws Exception {
        login("nobody@liveclass.test", "password123")
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("AUTH_INVALID_CREDENTIALS"));
    }

    @Test
    void login_establishes_session_that_me_accepts() throws Exception {
        signup("session@liveclass.test", "password123").andExpect(status().isCreated());

        MvcResult loginResult = login("session@liveclass.test", "password123")
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("session@liveclass.test"))
                .andReturn();

        // 세션 본체는 Redis에 있고 브라우저는 쿠키만 들고 다닌다 (ADR-0014).
        mockMvc.perform(get("/api/auth/me").cookie(cookiesOf(loginResult)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("session@liveclass.test"))
                .andExpect(jsonPath("$.role").value("STUDENT"));
    }

    @Test
    void me_without_session_returns_401() throws Exception {
        mockMvc.perform(get("/api/auth/me"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void logout_invalidates_the_session_so_me_returns_401_again() throws Exception {
        signup("logout@liveclass.test", "password123").andExpect(status().isCreated());
        MvcResult loginResult = login("logout@liveclass.test", "password123").andReturn();
        Cookie[] session = cookiesOf(loginResult);

        Csrf csrf = fetchCsrf();
        mockMvc.perform(withCsrf(post("/api/auth/logout"), csrf).cookie(session))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/auth/me").cookie(session))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void password_is_never_echoed_back() throws Exception {
        String body = signup("secret@liveclass.test", "password123").andReturn()
                .getResponse().getContentAsString();

        // 스키마 코멘트: password_hash 는 응답 DTO에 절대 노출 안 함.
        assertThat(body).doesNotContain("password").doesNotContain("bcrypt");
    }

    @Test
    void email_availability_returns_contract_shape() throws Exception {
        signup("taken@liveclass.test", "password123").andExpect(status().isCreated());

        mockMvc.perform(get("/api/auth/email-availability").param("email", "taken@liveclass.test"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.email").value("taken@liveclass.test"))
                .andExpect(jsonPath("$.available").value(false));

        mockMvc.perform(get("/api/auth/email-availability").param("email", "free@liveclass.test"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.available").value(true));
    }

    /** 프론트 인터셉터는 이 응답의 headerName/token을 그대로 에코한다 — 그 왕복이 실제로 통해야 한다. */
    @Test
    void csrf_token_from_endpoint_is_accepted_on_write_requests() throws Exception {
        Csrf csrf = fetchCsrf();

        assertThat(csrf.token()).isNotEmpty();
        assertThat(csrf.headerName()).isNotEmpty();
        assertThat(csrf.cookie()).isNotNull();

        mockMvc.perform(withCsrf(post("/api/auth/signup"), csrf)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(signupBody("csrf-ok@liveclass.test", "password123")))
                .andExpect(status().isCreated());
    }

    @Test
    void write_request_without_csrf_token_is_rejected() throws Exception {
        mockMvc.perform(post("/api/auth/signup")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(signupBody("no-csrf@liveclass.test", "password123")))
                .andExpect(status().isForbidden());
    }

    // ---- 가입 경로 제약 ----

    @Test
    void signup_rejects_operator_role() throws Exception {
        // app_user.role 코멘트: 가입 경로로는 STUDENT/INSTRUCTOR만 생성, OPERATOR는 별도.
        Csrf csrf = fetchCsrf();
        mockMvc.perform(withCsrf(post("/api/auth/signup"), csrf)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"op@liveclass.test","password":"password123","displayName":"운영자","role":"OPERATOR"}
                                """))
                .andExpect(status().isBadRequest());
    }

    @Test
    void signup_with_invalid_input_returns_400_with_field_errors() throws Exception {
        Csrf csrf = fetchCsrf();
        mockMvc.perform(withCsrf(post("/api/auth/signup"), csrf)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"email":"not-an-email","password":"short","displayName":"","role":"STUDENT"}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors").isArray())
                .andExpect(jsonPath("$.fieldErrors[*].field").exists())
                .andExpect(jsonPath("$.fieldErrors[*].code").exists());
    }

    /**
     * 표시 이름 변경. FE는 프로필 저장과 라이브 입장 전 별명 설정 두 곳에서 이 경로를 부른다.
     * 이름만 바뀌고 로그인 식별자(email)·역할은 그대로여야 한다.
     */
    @Test
    void display_name_change_is_reflected_in_me() throws Exception {
        signup("rename@liveclass.test", "password123").andExpect(status().isCreated());
        Cookie[] session = cookiesOf(login("rename@liveclass.test", "password123").andReturn());

        Csrf csrf = fetchCsrf();
        mockMvc.perform(withCsrf(put("/api/me/display-name"), csrf).cookie(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"바꾼이름"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("바꾼이름"));

        mockMvc.perform(get("/api/auth/me").cookie(session))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.displayName").value("바꾼이름"))
                .andExpect(jsonPath("$.email").value("rename@liveclass.test"))
                .andExpect(jsonPath("$.role").value("STUDENT"));
    }

    @Test
    void blank_display_name_is_rejected_with_field_errors() throws Exception {
        signup("blankname@liveclass.test", "password123").andExpect(status().isCreated());
        Cookie[] session = cookiesOf(login("blankname@liveclass.test", "password123").andReturn());

        Csrf csrf = fetchCsrf();
        mockMvc.perform(withCsrf(put("/api/me/display-name"), csrf).cookie(session)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"  "}
                                """))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors[*].field").exists());
    }

    @Test
    void display_name_change_without_session_returns_401() throws Exception {
        Csrf csrf = fetchCsrf();
        mockMvc.perform(withCsrf(put("/api/me/display-name"), csrf)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"displayName":"익명"}
                                """))
                .andExpect(status().isUnauthorized());
    }

    // ---- 프론트 왕복 재현 헬퍼 ----

    private record Csrf(Cookie cookie, String headerName, String token) {
    }

    private Csrf fetchCsrf() throws Exception {
        MvcResult result = mockMvc.perform(get("/api/auth/csrf"))
                .andExpect(status().isOk())
                .andReturn();
        String body = result.getResponse().getContentAsString();
        return new Csrf(
                result.getResponse().getCookie("XSRF-TOKEN"),
                readJsonString(body, "headerName"),
                readJsonString(body, "token")
        );
    }

    private MockHttpServletRequestBuilder withCsrf(MockHttpServletRequestBuilder builder, Csrf csrf) {
        return builder.cookie(csrf.cookie()).header(csrf.headerName(), csrf.token());
    }

    private ResultActions signup(String email, String password) throws Exception {
        Csrf csrf = fetchCsrf();
        return mockMvc.perform(withCsrf(post("/api/auth/signup"), csrf)
                .contentType(MediaType.APPLICATION_JSON)
                .content(signupBody(email, password)));
    }

    private ResultActions login(String email, String password) throws Exception {
        Csrf csrf = fetchCsrf();
        return mockMvc.perform(withCsrf(post("/api/auth/login"), csrf)
                .contentType(MediaType.APPLICATION_JSON)
                .content("""
                        {"email":"%s","password":"%s"}
                        """.formatted(email, password)));
    }

    private static String signupBody(String email, String password) {
        return """
                {"email":"%s","password":"%s","displayName":"김학생","role":"STUDENT"}
                """.formatted(email, password);
    }

    private static Cookie[] cookiesOf(MvcResult result) {
        List<Cookie> cookies = new ArrayList<>(List.of(result.getResponse().getCookies()));
        return cookies.toArray(new Cookie[0]);
    }

    private static String readJsonString(String json, String field) {
        return json.replaceAll(".*\"" + field + "\":\"([^\"]+)\".*", "$1");
    }
}
