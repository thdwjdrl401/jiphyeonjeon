package com.liveclass.aiintegration.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;

/**
 * Spring→ai-api RAG SSE 설정(ADR-0047). 시크릿은 콜백용 {@code ai.callback-secret}과 <b>다른 값</b>이다
 * — RAG는 {@code AI_INTERNAL_SECRET}, 콜백·download-url은 {@code AI_CALLBACK_SECRET}이다
 * (docs/ai/CONTRACT.md §3.2 secret 소유권).
 *
 * <ul>
 *   <li>{@code apiBaseUrl} — ai-api origin. 기본 {@code http://ai-api:8010}(compose 내부망 서비스명).</li>
 *   <li>{@code internalSecret} — HMAC 공유 시크릿. 운영은 env 주입, 커밋 금지.</li>
 *   <li>{@code connectTimeout} — TCP 연결 한도(짧게).</li>
 *   <li>{@code streamTimeout} — 스트림 전체 한도(길게). 모델이 토큰을 내는 동안 끊기면 안 된다.</li>
 * </ul>
 */
@ConfigurationProperties("liveclass.ai")
public record RagApiProperties(
        String apiBaseUrl,
        String internalSecret,
        Duration connectTimeout,
        Duration streamTimeout
) {

    public RagApiProperties {
        apiBaseUrl = hasText(apiBaseUrl) ? stripTrailingSlash(apiBaseUrl) : "http://ai-api:8010";
        internalSecret = hasText(internalSecret) ? internalSecret : "dev-ai-internal-secret";
        connectTimeout = positive(connectTimeout) ? connectTimeout : Duration.ofSeconds(3);
        streamTimeout = positive(streamTimeout) ? streamTimeout : Duration.ofMinutes(5);
    }

    /** ai-api RAG 스트림 endpoint. 경로는 {@code :stream} 접미사(ai-api 소유 규격)다. */
    public URI answersStreamUri() {
        return URI.create(apiBaseUrl + "/internal/v1/rag/answers:stream");
    }

    private static boolean hasText(String s) {
        return s != null && !s.isBlank();
    }

    private static boolean positive(Duration d) {
        return d != null && !d.isZero() && !d.isNegative();
    }

    private static String stripTrailingSlash(String url) {
        String trimmed = url.trim();
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }
}
