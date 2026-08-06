package com.liveclass.video.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Duration;

/**
 * 호스트에 둔 회수 중계(infra/livekit/egress-purger)에 대고 유령 기록을 지운다.
 *
 * <p>왜 중계를 거치나: LiveKit Redis는 {@code --bind 127.0.0.1} + host 네트워크라 EC2 로컬에서만
 * 닿는데 백엔드는 브리지(liveclass_default)에 있다. 브리지에 그 Redis를 열면 인증 없는 제어 평면이
 * 같은 네트워크의 모든 컨테이너에 열리므로, Redis는 비공개로 두고 "유령 하나 제거"라는 동사 하나만
 * 공유 시크릿으로 인증해 부른다.
 *
 * <p>중계는 지우기 직전에 스스로 StopEgress를 보내 유령임을 다시 확인한다. 그래서 이 클래스가
 * 잘못 불려도 살아 있는 녹화는 지워지지 않는다 — 위험한 판단을 조작하는 쪽에 둔 것이다.
 */
@Component
public class EgressOrphanPurgeHttpClient implements EgressOrphanPurge {

    private static final Logger log = LoggerFactory.getLogger(EgressOrphanPurgeHttpClient.class);

    private final String baseUrl;
    private final String secret;
    private final HttpClient http;

    public EgressOrphanPurgeHttpClient(
            @Value("${liveclass.egress.purger.base-url:}") String baseUrl,
            @Value("${liveclass.egress.purger.secret:}") String secret) {
        this.baseUrl = baseUrl == null ? "" : baseUrl.trim();
        this.secret = secret == null ? "" : secret.trim();
        this.http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(3)).build();
    }

    @Override
    public boolean isAvailable() {
        return !baseUrl.isEmpty() && !secret.isEmpty();
    }

    @Override
    public void purgeOrphan(String egressId) {
        if (!isAvailable()) {
            throw new EgressControlException("이 배포에는 회수 중계가 설정되어 있지 않다");
        }
        // egressId는 콘솔이 목록에서 준 값이지만 그대로 믿지 않는다 — 중계도 형식을 다시 본다.
        String body = "{\"egressId\":\"%s\"}".formatted(egressId.replace("\"", ""));
        HttpRequest request = HttpRequest.newBuilder(URI.create(baseUrl + "/purge"))
                .header("Content-Type", "application/json")
                .header("X-Purge-Secret", secret)
                .timeout(Duration.ofSeconds(20))
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build();
        try {
            HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) {
                log.warn("유령 Egress 회수 egressId={} 응답={}", egressId, response.body());
                return;
            }
            // 중계가 거부한 이유(유령이 아님·기록 없음 등)를 그대로 올려 콘솔이 사람에게 보여 준다.
            throw new EgressControlException(
                    "회수 거부(HTTP %d): %s".formatted(response.statusCode(), response.body()));
        } catch (IOException e) {
            throw new EgressControlException("회수 중계와 통신 실패: " + egressId, e);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new EgressControlException("회수 중계 호출이 중단됨: " + egressId, e);
        }
    }
}
