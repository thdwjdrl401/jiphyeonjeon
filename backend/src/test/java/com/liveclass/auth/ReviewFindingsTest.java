package com.liveclass.auth;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 실제 HTTP로 도는 계약 검증.
 * MockMvc는 서블릿 ERROR 디스패치(/error 포워딩)를 재현하지 않아 오류 응답 계약을 구조적으로 못 잡는다
 * — 여기 있는 검증은 전부 MockMvc에서는 통과해버린다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class ReviewFindingsTest {

    @LocalServerPort
    private int port;

    private final HttpClient client = HttpClient.newHttpClient();

    // ---- 오류 응답이 401로 위장되지 않아야 한다 ----

    /**
     * 로그인한 사용자가 없는 경로를 치면 404여야 한다. 401이면 프론트가 "로그아웃됐다"고 오해해
     * 인증 상태를 버린다(client.ts는 401에서 CSRF 캐시를 비운다).
     * 익명 요청이 401을 받는 건 정상 — 인증 전에는 경로 존재 여부 자체를 알려주지 않는다.
     */
    @Test
    void unknown_path_for_logged_in_user_returns_404_not_401() throws Exception {
        String session = loginAndGetSessionCookie(uniqueEmail("known-path"), "password123");

        HttpResponse<String> response = client.send(
                HttpRequest.newBuilder(uri("/api/auth/does-not-exist"))
                        .header("Cookie", session).GET().build(),
                HttpResponse.BodyHandlers.ofString());

        assertThat(response.statusCode()).isEqualTo(404);
    }

    @Test
    void missing_required_param_returns_400_with_contract_code() throws Exception {
        HttpResponse<String> response = get("/api/auth/email-availability");
        assertThat(response.statusCode()).isEqualTo(400);
        assertThat(response.body()).contains("VALIDATION_FAILED");
    }

    @Test
    void blank_param_returns_400() throws Exception {
        assertThat(get("/api/auth/email-availability?email=").statusCode()).isEqualTo(400);
    }

    // ---- BCrypt 72바이트 한계 (문자 수가 아니라 바이트 수) ----

    /** 한글 25자 = 75바이트. 문자 수로만 재면 통과시킨 뒤 인코딩에서 터져 500(→401)이 된다. */
    @Test
    void korean_password_over_72_bytes_is_rejected_with_400_not_500() throws Exception {
        HttpResponse<String> response = signup(uniqueEmail("korean-long"), "가".repeat(25));
        assertThat(response.statusCode()).isEqualTo(400);
        assertThat(response.body()).contains("VALIDATION_FAILED");
    }

    /** 한글 24자 = 72바이트. 한계 이내는 정상 가입돼야 한다(과잉 차단 방지). */
    @Test
    void korean_password_within_72_bytes_is_accepted() throws Exception {
        assertThat(signup(uniqueEmail("korean-ok"), "가".repeat(24)).statusCode()).isEqualTo(201);
    }

    // ---- 요청 헬퍼 (프론트의 CSRF 왕복을 그대로 재현) ----

    private record Csrf(String cookie, String headerName, String token) {
    }

    private Csrf fetchCsrf() throws Exception {
        HttpResponse<String> response = get("/api/auth/csrf");
        String setCookie = response.headers().firstValue("set-cookie").orElseThrow();
        return new Csrf(
                setCookie.split(";")[0],
                readJsonString(response.body(), "headerName"),
                readJsonString(response.body(), "token"));
    }

    private HttpResponse<String> get(String path) throws Exception {
        return client.send(
                HttpRequest.newBuilder(uri(path)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    private HttpResponse<String> signup(String email, String password) throws Exception {
        Csrf csrf = fetchCsrf();
        String body = """
                {"email":"%s","password":"%s","displayName":"김학생","role":"STUDENT"}
                """.formatted(email, password);

        return client.send(
                HttpRequest.newBuilder(uri("/api/auth/signup"))
                        .header("Content-Type", "application/json")
                        .header("Cookie", csrf.cookie())
                        .header(csrf.headerName(), csrf.token())
                        .POST(HttpRequest.BodyPublishers.ofString(body))
                        .build(),
                HttpResponse.BodyHandlers.ofString());
    }

    /** 가입 → 로그인 후 세션 쿠키를 돌려준다. 이미 가입된 이메일이어도 무방하다. */
    private String loginAndGetSessionCookie(String email, String password) throws Exception {
        signup(email, password);

        Csrf csrf = fetchCsrf();
        HttpResponse<String> login = client.send(
                HttpRequest.newBuilder(uri("/api/auth/login"))
                        .header("Content-Type", "application/json")
                        .header("Cookie", csrf.cookie())
                        .header(csrf.headerName(), csrf.token())
                        .POST(HttpRequest.BodyPublishers.ofString("""
                                {"email":"%s","password":"%s"}
                                """.formatted(email, password)))
                        .build(),
                HttpResponse.BodyHandlers.ofString());

        assertThat(login.statusCode()).isEqualTo(200);
        return login.headers().allValues("set-cookie").stream()
                .filter(cookie -> cookie.startsWith("SESSION") || cookie.startsWith("LIVECLASS_SESSION"))
                .map(cookie -> cookie.split(";")[0])
                .findFirst()
                .orElseThrow(() -> new AssertionError("로그인 응답에 세션 쿠키가 없다: " + login.headers().allValues("set-cookie")));
    }

    /** 이 테스트는 실제 서버라 롤백이 없다 — 재실행해도 중복 가입(409)이 되지 않도록 매번 새 이메일을 쓴다. */
    private static String uniqueEmail(String prefix) {
        return prefix + "-" + UUID.randomUUID() + "@liveclass.test";
    }

    private URI uri(String path) {
        return URI.create("http://localhost:" + port + path);
    }

    private static String readJsonString(String json, String field) {
        return json.replaceAll(".*\"" + field + "\":\"([^\"]+)\".*", "$1");
    }
}
