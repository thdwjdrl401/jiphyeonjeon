package com.liveclass.live.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;

/**
 * 판서 해석용 GMS 설정(ADR-0054).
 *
 * <p><b>ai-api를 거치지 않는다.</b> 판서 해석에는 검색도 임베딩도 자막 컨텍스트도 없어, 이미지를
 * 모델에 넘기고 툴콜을 검증해 돌려주는 것이 전부다. 그 호출에 홉과 HMAC 서명을 하나씩 더 얹을
 * 이유가 없다. RAG 컨텍스트가 필요해지면 그때 ai-api로 옮기며, 그때도 FE 계약(§3-6e)은 그대로다.
 *
 * <p><b>브라우저는 이 값을 절대 받지 않는다.</b> {@code apiKey}가 클라이언트로 나가는 순간 누구나
 * 우리 이름으로 모델을 부를 수 있다. 그래서 이미지를 클라이언트가 직접 GMS에 보내지 않고 Spring을
 * 거친다.
 */
@ConfigurationProperties("liveclass.annotation-ai")
public record AnnotationAiProperties(
        String baseUrl,
        String apiKey,
        String model,
        Duration connectTimeout,
        Duration requestTimeout,
        int maxImageBytes
) {

    public AnnotationAiProperties {
        baseUrl = hasText(baseUrl) ? stripTrailingSlash(baseUrl) : "https://api.openai.com/v1";
        apiKey = hasText(apiKey) ? apiKey : "";
        model = hasText(model) ? model : "gpt-4.1";
        connectTimeout = positive(connectTimeout) ? connectTimeout : Duration.ofSeconds(5);
        // 이미지를 읽는 호출이라 텍스트 질의보다 길다. 강사가 기다리는 화면이므로 무한정 둘 수도 없다.
        requestTimeout = positive(requestTimeout) ? requestTimeout : Duration.ofSeconds(60);
        // 프레임 한 장을 PNG로 담아도 이보다 훨씬 작다. 상한이 없으면 큰 body 하나로 힙을 밀 수 있다.
        maxImageBytes = maxImageBytes > 0 ? maxImageBytes : 4 * 1024 * 1024;
    }

    /** 키가 없으면 기능을 끈 것으로 본다 — 로컬에서 키 없이 띄워도 강의는 그대로 돌아야 한다. */
    public boolean enabled() {
        return !apiKey.isEmpty();
    }

    public URI chatCompletionsUri() {
        return URI.create(baseUrl + "/chat/completions");
    }

    private static boolean hasText(String value) {
        return value != null && !value.isBlank();
    }

    private static boolean positive(Duration value) {
        return value != null && !value.isNegative() && !value.isZero();
    }

    private static String stripTrailingSlash(String value) {
        String trimmed = value.trim();
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }
}
