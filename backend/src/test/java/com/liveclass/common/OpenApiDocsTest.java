package com.liveclass.common;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

import static org.assertj.core.api.Assertions.assertThat;

/** springdoc이 실제로 스펙을 생성하고 인증 엔드포인트가 문서에 노출되는지 검증. */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class OpenApiDocsTest {

    @LocalServerPort
    private int port;

    private final HttpClient client = HttpClient.newHttpClient();

    private HttpResponse<String> get(String path) throws Exception {
        return client.send(
                HttpRequest.newBuilder(URI.create("http://localhost:" + port + path)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
    }

    @Test
    void api_docs_json_is_served_without_auth_and_lists_auth_endpoints() throws Exception {
        HttpResponse<String> response = get("/v3/api-docs");

        assertThat(response.statusCode()).isEqualTo(200);
        String spec = response.body();
        assertThat(spec).contains("\"/api/auth/signup\"");
        assertThat(spec).contains("\"/api/auth/login\"");
        assertThat(spec).contains("\"/api/auth/email-availability\"");
        assertThat(spec).contains("LiveClass AI API");
    }

    @Test
    void swagger_ui_is_reachable_without_auth() throws Exception {
        // /swagger-ui.html 은 /swagger-ui/index.html 로 리다이렉트된다 — 401만 아니면 된다.
        HttpResponse<String> response = get("/swagger-ui/index.html");
        assertThat(response.statusCode()).isEqualTo(200);
    }
}
