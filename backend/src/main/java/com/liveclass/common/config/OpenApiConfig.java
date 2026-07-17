package com.liveclass.common.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * API 문서(springdoc-openapi) 전역 메타데이터. 스펙 정본은 코드에서 생성되며,
 * /swagger-ui/index.html(UI) · /v3/api-docs(JSON)로 노출된다.
 */
@Configuration
public class OpenApiConfig {

    @Bean
    public OpenAPI liveClassOpenApi() {
        return new OpenAPI().info(new Info()
                .title("LiveClass AI API")
                .description("""
                        컨트롤 플레인 REST API. 인증은 HttpOnly 쿠키 세션(Redis)이며 `Authorization: Bearer`를 쓰지 않는다(ADR-0014).
                        변경 요청(POST/PUT/PATCH/DELETE)은 `GET /api/auth/csrf`로 받은 토큰을 `X-XSRF-TOKEN` 헤더로 에코해야 한다.""")
                .version("v0")
                .license(new License().name("Team liveclass")));
    }
}
