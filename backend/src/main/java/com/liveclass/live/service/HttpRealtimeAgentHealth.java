package com.liveclass.live.service;

import com.liveclass.live.api.RealtimeAgentHealth;
import com.liveclass.live.config.RealtimeAgentHealthProperties;
import tools.jackson.databind.json.JsonMapper;

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

public final class HttpRealtimeAgentHealth implements RealtimeAgentHealth {

    private static final String CONTRACT_VERSION = "1";
    private static final String SERVICE = "realtime-agent";

    private final HttpClient httpClient;
    private final JsonMapper jsonMapper;
    private final RealtimeAgentHealthProperties properties;

    public HttpRealtimeAgentHealth(
            HttpClient httpClient,
            JsonMapper jsonMapper,
            RealtimeAgentHealthProperties properties) {
        this.httpClient = httpClient;
        this.jsonMapper = jsonMapper;
        this.properties = properties;
    }

    @Override
    public Liveness liveness() {
        HttpResponse<String> response = get("health/live");
        if (response.statusCode() != 200) {
            throw invalidResponse("liveness", response.statusCode());
        }
        Liveness body = read(response.body(), Liveness.class);
        if (body == null
                || !CONTRACT_VERSION.equals(body.contractVersion())
                || !SERVICE.equals(body.service())
                || !"alive".equals(body.status())) {
            throw invalidResponse("liveness payload", response.statusCode());
        }
        return body;
    }

    @Override
    public Readiness readiness() {
        HttpResponse<String> response = get("health/ready");
        if (response.statusCode() != 200 && response.statusCode() != 503) {
            throw invalidResponse("readiness", response.statusCode());
        }
        Readiness body = read(response.body(), Readiness.class);
        if (body == null
                || !CONTRACT_VERSION.equals(body.contractVersion())
                || !SERVICE.equals(body.service())
                || body.sttProvider() == null
                || body.sttProvider().isBlank()
                || body.readyProcessCount() < 0
                || body.expectedProcessCount() < 1) {
            throw invalidResponse("readiness payload", response.statusCode());
        }
        boolean httpReady = response.statusCode() == 200;
        if (httpReady != body.ready() || (!httpReady && !"notReady".equals(body.status()))) {
            throw invalidResponse("readiness status", response.statusCode());
        }
        return body;
    }

    private HttpResponse<String> get(String relativePath) {
        URI uri = properties.baseUrl().resolve(relativePath);
        HttpRequest request = HttpRequest.newBuilder(uri)
                .timeout(properties.timeout())
                .header("Accept", "application/json")
                .GET()
                .build();
        try {
            return httpClient.send(request, HttpResponse.BodyHandlers.ofString());
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("realtime-agent health 요청이 중단됐습니다.", exception);
        } catch (IOException exception) {
            throw new IllegalStateException("realtime-agent health에 연결할 수 없습니다.", exception);
        }
    }

    private <T> T read(String body, Class<T> type) {
        try {
            return jsonMapper.readValue(body, type);
        } catch (RuntimeException exception) {
            throw new IllegalStateException("realtime-agent health 응답 JSON이 계약과 다릅니다.", exception);
        }
    }

    private static IllegalStateException invalidResponse(String kind, int statusCode) {
        return new IllegalStateException(
                "realtime-agent " + kind + " 응답이 계약과 다릅니다. status=" + statusCode);
    }
}
