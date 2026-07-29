package com.liveclass.live.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.net.URI;
import java.time.Duration;

@ConfigurationProperties("live.stt.health")
public record RealtimeAgentHealthProperties(URI baseUrl, Duration timeout) {

    private static final URI DEFAULT_BASE_URL = URI.create("http://127.0.0.1:18081/");

    public RealtimeAgentHealthProperties {
        baseUrl = normalize(baseUrl != null ? baseUrl : DEFAULT_BASE_URL);
        timeout = timeout != null ? timeout : Duration.ofSeconds(2);
        if (!("http".equals(baseUrl.getScheme()) || "https".equals(baseUrl.getScheme()))
                || baseUrl.getHost() == null) {
            throw new IllegalArgumentException("live.stt.health.base-url은 http 또는 https URL이어야 합니다.");
        }
        if (baseUrl.getQuery() != null || baseUrl.getFragment() != null) {
            throw new IllegalArgumentException("live.stt.health.base-url에는 query나 fragment를 둘 수 없습니다.");
        }
        if (timeout.isZero() || timeout.isNegative()) {
            throw new IllegalArgumentException("live.stt.health.timeout은 양수여야 합니다.");
        }
    }

    private static URI normalize(URI value) {
        String raw = value.toString();
        return URI.create(raw.endsWith("/") ? raw : raw + "/");
    }
}
