package com.liveclass.common.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Components;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * API 문서(springdoc-openapi) 전역 메타데이터. 스펙 정본은 코드에서 생성되며,
 * /swagger-ui/index.html(UI) · /v3/api-docs(JSON)로 노출된다.
 */
@Configuration
public class OpenApiConfig {

    private static final String CSRF_SCHEME = "X-XSRF-TOKEN";

    @Bean
    public OpenAPI liveClassOpenApi() {
        return new OpenAPI()
                .components(new Components().addSecuritySchemes(
                        CSRF_SCHEME,
                        new SecurityScheme()
                                .type(SecurityScheme.Type.APIKEY)
                                .in(SecurityScheme.In.HEADER)
                                .name(CSRF_SCHEME)
                                .description("""
                                        Swagger에서 변경 요청을 시험할 때 사용한다.
                                        먼저 GET /api/auth/csrf의 token 값을 복사한 뒤 우측 상단 Authorize에 입력한다.
                                        인증은 이 값이 아니라 LIVECLASS_SESSION 쿠키가 담당한다.""")))
                .addSecurityItem(new SecurityRequirement().addList(CSRF_SCHEME))
                .info(new Info()
                        .title("LiveClass AI API")
                        .description("""
                                컨트롤 플레인 REST API. 인증은 HttpOnly 쿠키 세션(Redis)이며 `Authorization: Bearer`를 쓰지 않는다(ADR-0014).
                                변경 요청(POST/PUT/PATCH/DELETE)은 `GET /api/auth/csrf`로 받은 token을 우측 상단 Authorize의
                                `X-XSRF-TOKEN` 값으로 입력해야 한다. Swagger와 API가 같은 localhost:8080 origin이므로
                                로그인 성공 뒤 `LIVECLASS_SESSION` 쿠키는 브라우저가 자동 전송한다.""")
                        .version("v0")
                        .license(new License().name("Team liveclass")));
    }
}
