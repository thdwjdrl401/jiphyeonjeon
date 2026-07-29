package com.liveclass.live;

import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.live.domain.LiveCaption;
import com.liveclass.live.repository.LiveCaptionRepository;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.live.service.LiveStartOrchestrator;
import com.liveclass.support.LiveStartTestSupport;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 라이브 AI 질의응답 SSE 프록시 계약(ADR-0047, AI-QUESTION-01).
 *
 * <p>ai-api를 목 HTTP 서버로 세워 <b>실제 ai-api 없이</b> 다음을 고정한다.
 * <ul>
 *   <li>서명: {@code X-Internal-Signature}가 우리가 실제로 보낸 <b>원시 body 바이트</b>의 HMAC과 일치</li>
 *   <li>body: 6개 필드만(extra 금지)·소문자 canonical UUID·질문 무-trim·신선한 {@code issuedAtMs}</li>
 *   <li>{@code contextTimeMs} = 해당 세션 최신 자막의 raw {@code streamElapsedMs}(없으면 0)</li>
 *   <li>SSE 릴레이: delta n개 + terminal 1개를 <b>변환 없이</b> 그대로 브라우저로</li>
 *   <li>인가: 비참가자 403, 없는 세션 404</li>
 *   <li>에러 매핑: 503→503·409→409·401→502(401을 그대로 흘리지 않음)</li>
 * </ul>
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LiveAiAnswerContractTest {

    private static final String SECRET = "test-ai-internal-secret";

    private static HttpServer aiApi;
    private static final AtomicReference<Responder> responder = new AtomicReference<>();
    private static final AtomicReference<CapturedRequest> captured = new AtomicReference<>();

    /** 목 ai-api가 요청 하나에 어떻게 응답할지. */
    private interface Responder {
        void respond(HttpExchange exchange) throws IOException;
    }

    private record CapturedRequest(String path, Map<String, String> headers, byte[] rawBody) {
    }

    @BeforeAll
    static void startAiApi() throws IOException {
        aiApi = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        aiApi.createContext("/", exchange -> {
            byte[] body = exchange.getRequestBody().readAllBytes();
            Map<String, String> headers = Map.of(
                    "X-Internal-Signature", header(exchange, "X-Internal-Signature"),
                    "Accept", header(exchange, "Accept"),
                    "Content-Type", header(exchange, "Content-Type"));
            captured.set(new CapturedRequest(exchange.getRequestURI().getPath(), headers, body));
            Responder current = responder.get();
            try {
                current.respond(exchange);
            } finally {
                exchange.close();
            }
        });
        aiApi.start();
    }

    @AfterAll
    static void stopAiApi() {
        aiApi.stop(0);
    }

    @DynamicPropertySource
    static void aiApiProperties(DynamicPropertyRegistry registry) {
        registry.add("liveclass.ai.api-base-url", () -> "http://127.0.0.1:" + aiApi.getAddress().getPort());
        registry.add("liveclass.ai.internal-secret", () -> SECRET);
        registry.add("liveclass.ai.stream-timeout", () -> "30s");
    }

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private LiveCaptionRepository liveCaptionRepository;

    @MockitoBean
    private LiveRoomControl roomControl;

    @MockitoBean
    private LiveRecordingControl recordingControl;

    @MockitoBean
    private AgentDispatchControl agentDispatchControl;

    @Autowired
    private LiveStartOrchestrator startOrchestrator;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @BeforeEach
    void resetMock() {
        captured.set(null);
        responder.set(exchange -> sse(exchange,
                "event: answer.done\ndata: {\"requestId\":\"r\",\"sources\":[]}\n\n"));
    }

    // ---- 서명·body 계약 ----

    @Test
    void signs_the_exact_raw_body_it_sends() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);

        ask(created[0], instructor, "  방금 설명한 개념은?  ").andExpect(status().isOk());

        CapturedRequest request = awaitRequest();
        // 서명 대상은 "우리가 실제로 보낸 바이트"다 — 재직렬화하면 여기서 깨진다.
        assertThat(request.headers().get("X-Internal-Signature")).isEqualTo(hmacBase64(SECRET, request.rawBody()));
        assertThat(request.path()).isEqualTo("/internal/v1/rag/answers:stream");
        assertThat(request.headers().get("Accept")).contains("text/event-stream");
        assertThat(request.headers().get("Content-Type")).contains("application/json");
    }

    @Test
    void request_body_has_only_the_six_contract_fields() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);
        String sessionId = created[0];

        long before = System.currentTimeMillis();
        ask(sessionId, instructor, "  질문 원문 그대로  ").andExpect(status().isOk());
        long after = System.currentTimeMillis();

        JsonNode body = jsonMapper.readTree(new String(awaitRequest().rawBody(), StandardCharsets.UTF_8));
        // ai-api는 extra="forbid" — 필드가 하나라도 늘면 400이다.
        assertThat(body.size()).isEqualTo(6);
        assertThat(body.has("requestId")).isTrue();
        assertThat(body.has("lessonId")).isTrue();
        assertThat(body.has("sessionId")).isTrue();
        assertThat(body.has("question")).isTrue();
        assertThat(body.has("contextTimeMs")).isTrue();
        assertThat(body.has("issuedAtMs")).isTrue();

        // 소문자 canonical UUID. sessionId는 경로 값과 같고 lessonId는 서버가 세션에서 조회한 값.
        String sessionIdField = body.get("sessionId").asString();
        String lessonIdField = body.get("lessonId").asString();
        assertThat(sessionIdField).isEqualTo(sessionId.toLowerCase());
        assertThat(sessionIdField).isEqualTo(UUID.fromString(sessionIdField).toString());
        assertThat(lessonIdField).isEqualTo(created[2].toLowerCase());
        assertThat(lessonIdField).isEqualTo(UUID.fromString(lessonIdField).toString());

        // 질문은 trim하지 않는다(양끝 공백 보존).
        assertThat(body.get("question").asString()).isEqualTo("  질문 원문 그대로  ");
        // requestId는 서버 생성(1~128자) — 클라 재사용에 의한 409를 원천 차단한다.
        assertThat(body.get("requestId").asString()).isNotBlank().hasSizeLessThanOrEqualTo(128);
        // 신선도: 전송 직전 시각이어야 한다(수신과 60초 이상 차이나거나 5초 초과 미래면 ai-api가 401).
        assertThat(body.get("issuedAtMs").asLong()).isBetween(before, after);
    }

    @Test
    void context_time_ms_is_the_latest_caption_stream_elapsed_ms() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);
        UUID sessionId = UUID.fromString(created[0]);
        UUID lessonId = UUID.fromString(created[2]);

        saveCaption(sessionId, lessonId, "evt-1", 1L, 12_000L, OffsetDateTime.now().minusSeconds(30));
        saveCaption(sessionId, lessonId, "evt-2", 2L, 41_500L, OffsetDateTime.now().minusSeconds(5));

        ask(created[0], instructor, "지금까지 요약해줘").andExpect(status().isOk());

        JsonNode body = jsonMapper.readTree(new String(awaitRequest().rawBody(), StandardCharsets.UTF_8));
        // 세션-ms가 아니라 raw attempt-local streamElapsedMs 좌표다(변환 없음 → 앵커 문제 없음).
        assertThat(body.get("contextTimeMs").asLong()).isEqualTo(41_500L);
    }

    @Test
    void context_time_ms_is_zero_when_the_session_has_no_caption() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);

        ask(created[0], instructor, "자막 없이 질문").andExpect(status().isOk());

        JsonNode body = jsonMapper.readTree(new String(awaitRequest().rawBody(), StandardCharsets.UTF_8));
        assertThat(body.get("contextTimeMs").asLong()).isZero();
    }

    // ---- SSE 릴레이 ----

    @Test
    void relays_ai_api_events_verbatim() throws Exception {
        responder.set(exchange -> sse(exchange,
                "event: answer.delta\ndata: {\"requestId\":\"r-1\",\"text\":\"RAG는 \"}\n\n",
                "event: answer.delta\ndata: {\"requestId\":\"r-1\",\"text\":\"검색 증강입니다.\"}\n\n",
                "event: answer.done\ndata: {\"requestId\":\"r-1\",\"sources\":"
                        + "[{\"type\":\"PPTX\",\"materialId\":\"22222222-2222-4222-8222-222222222222\",\"page\":4}]}\n\n"));

        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);

        MvcResult result = ask(created[0], instructor, "RAG가 뭐야?")
                .andExpect(status().isOk())
                .andReturn();

        String relayed = awaitSse(result, "answer.done");
        // 이름과 data를 변환하지 않는다 — FE는 ai-api 스키마 그대로 소비한다.
        assertThat(relayed).contains("event:answer.delta");
        assertThat(relayed).contains("data:{\"requestId\":\"r-1\",\"text\":\"RAG는 \"}");
        assertThat(relayed).contains("data:{\"requestId\":\"r-1\",\"text\":\"검색 증강입니다.\"}");
        assertThat(relayed).contains("event:answer.done");
        assertThat(relayed).contains("\"type\":\"PPTX\"");
        // terminal은 정확히 하나.
        assertThat(countOccurrences(relayed, "event:answer.done")).isEqualTo(1);
        assertThat(relayed).doesNotContain("event:answer.error");
    }

    @Test
    void relays_insufficient_terminal_as_is() throws Exception {
        responder.set(exchange -> sse(exchange,
                "event: answer.insufficient\ndata: {\"requestId\":\"r-2\",\"message\":\"근거가 부족합니다.\"}\n\n"));

        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);

        MvcResult result = ask(created[0], instructor, "관련 없는 질문").andExpect(status().isOk()).andReturn();

        String relayed = awaitSse(result, "answer.insufficient");
        assertThat(relayed).contains("event:answer.insufficient");
        assertThat(relayed).contains("\"message\":\"근거가 부족합니다.\"");
    }

    @Test
    void emits_answer_error_when_upstream_ends_without_a_terminal() throws Exception {
        // delta만 보내고 끊는다 — 규격상 terminal이 하나 와야 하므로 프록시가 대신 알려야 한다.
        responder.set(exchange -> sse(exchange,
                "event: answer.delta\ndata: {\"requestId\":\"r-3\",\"text\":\"중간에\"}\n\n"));

        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);

        MvcResult result = ask(created[0], instructor, "끊기는 질문").andExpect(status().isOk()).andReturn();

        String relayed = awaitSse(result, "answer.error");
        assertThat(relayed).contains("event:answer.delta");
        assertThat(relayed).contains("event:answer.error");
        assertThat(relayed).contains("PROXY_STREAM_INCOMPLETE");
        assertThat(relayed).contains("\"retryable\":true");
    }

    // ---- 인가 ----

    @Test
    void non_participant_is_forbidden_and_ai_api_is_never_called() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);

        Cookie[] outsider = loginAs("STUDENT");   // 수강 신청 안 함
        ask(created[0], outsider, "몰래 질문")
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_FORBIDDEN"));

        assertThat(captured.get()).isNull();   // 인가 실패 시 ai-api를 부르지 않는다(비용·유출 방지)
    }

    @Test
    void active_enrollee_can_ask() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);
        Cookie[] student = loginAs("STUDENT");
        enrollActive(created[1], student, instructor);

        ask(created[0], student, "수강생 질문").andExpect(status().isOk());
        assertThat(awaitRequest()).isNotNull();
    }

    @Test
    void unknown_session_is_404() throws Exception {
        Cookie[] student = loginAs("STUDENT");
        ask(UUID.randomUUID().toString(), student, "없는 세션")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_NOT_FOUND"));
    }

    @Test
    void requires_authentication() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);

        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = json(csrf);
        mockMvc.perform(post("/api/live-sessions/" + created[0] + "/ai/answers/stream")
                        .cookie(csrf.getResponse().getCookie("XSRF-TOKEN"))
                        .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"question\":\"익명 질문\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void blank_or_too_long_question_is_400() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);

        ask(created[0], instructor, "")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"));

        ask(created[0], instructor, "가".repeat(4001))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.fieldErrors[?(@.field=='question')].code").value("INVALID_LENGTH"));

        assertThat(captured.get()).isNull();
    }

    // ---- 에러 매핑(스트림 시작 전) ----

    @Test
    void upstream_503_becomes_503_ai_answer_unavailable() throws Exception {
        responder.set(exchange -> statusOnly(exchange, 503));

        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);

        ask(created[0], instructor, "AI 준비됐어?")
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("AI_ANSWER_UNAVAILABLE"));
    }

    @Test
    void upstream_409_becomes_409_so_the_client_can_retry() throws Exception {
        responder.set(exchange -> statusOnly(exchange, 409));

        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);

        ask(created[0], instructor, "중복 요청")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("AI_ANSWER_REQUEST_CONFLICT"));
    }

    @Test
    void upstream_401_is_not_leaked_as_401() throws Exception {
        // 서명 거부는 우리 설정 문제다. 401을 그대로 흘리면 FE가 세션 만료로 오해해 로그아웃한다.
        responder.set(exchange -> statusOnly(exchange, 401));

        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);

        ask(created[0], instructor, "서명 틀린 요청")
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("AI_ANSWER_UPSTREAM_REJECTED"));
    }

    @Test
    void upstream_400_becomes_502_not_400() throws Exception {
        responder.set(exchange -> statusOnly(exchange, 400));

        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);

        ask(created[0], instructor, "계약 위반")
                .andExpect(status().isBadGateway())
                .andExpect(jsonPath("$.code").value("AI_ANSWER_UPSTREAM_REJECTED"));
    }

    // ---- 헬퍼 ----

    private static String header(HttpExchange exchange, String name) {
        String value = exchange.getRequestHeaders().getFirst(name);
        return value == null ? "" : value;
    }

    private static void sse(HttpExchange exchange, String... frames) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
        exchange.sendResponseHeaders(200, 0);   // 0 = chunked, 스트리밍
        try (OutputStream out = exchange.getResponseBody()) {
            for (String frame : frames) {
                out.write(frame.getBytes(StandardCharsets.UTF_8));
                out.flush();
            }
        }
    }

    private static void statusOnly(HttpExchange exchange, int status) throws IOException {
        byte[] body = "{\"detail\":\"nope\"}".getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, body.length);
        try (OutputStream out = exchange.getResponseBody()) {
            out.write(body);
        }
    }

    private static String hmacBase64(String secret, byte[] body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return Base64.getEncoder().encodeToString(mac.doFinal(body));
    }

    private static int countOccurrences(String haystack, String needle) {
        int count = 0;
        int at = haystack.indexOf(needle);
        while (at >= 0) {
            count++;
            at = haystack.indexOf(needle, at + needle.length());
        }
        return count;
    }

    /** 목 ai-api가 요청을 실제로 받을 때까지 기다린다(요청은 컨트롤러 스레드에서 이미 완료된 뒤). */
    private CapturedRequest awaitRequest() throws InterruptedException {
        long deadline = System.currentTimeMillis() + 5_000;
        while (System.currentTimeMillis() < deadline) {
            CapturedRequest request = captured.get();
            if (request != null) {
                return request;
            }
            Thread.sleep(10);
        }
        throw new AssertionError("ai-api 목이 요청을 받지 못했다");
    }

    /** 릴레이가 terminal을 흘릴 때까지 기다린 뒤 응답 본문을 읽는다(SSE는 비동기로 쓰인다). */
    private String awaitSse(MvcResult result, String terminalEvent) throws Exception {
        long deadline = System.currentTimeMillis() + 10_000;
        while (System.currentTimeMillis() < deadline) {
            String body = new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
            if (body.contains(terminalEvent)) {
                Thread.sleep(100);   // 마지막 프레임이 다 쓰이도록 잠시 대기
                return new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8);
            }
            Thread.sleep(20);
        }
        throw new AssertionError("SSE에 " + terminalEvent + "가 오지 않았다: "
                + new String(result.getResponse().getContentAsByteArray(), StandardCharsets.UTF_8));
    }

    private void saveCaption(UUID sessionId, UUID lessonId, String eventId,
                             long sequence, long streamElapsedMs, OffsetDateTime occurredAt) {
        LiveCaption caption = new LiveCaption();
        caption.setEventId(eventId + "-" + UUID.randomUUID());
        caption.setEventType("caption.delta");
        caption.setSessionId(sessionId);
        caption.setLessonId(lessonId);
        caption.setSttSessionId("stt-attempt-1");
        caption.setSequence(sequence);
        caption.setStreamElapsedMs(streamElapsedMs);
        caption.setText("자막 " + sequence);
        caption.setOccurredAt(occurredAt);
        liveCaptionRepository.saveAndFlush(caption);
    }

    private org.springframework.test.web.servlet.ResultActions ask(String sessionId, Cookie[] auth, String question)
            throws Exception {
        String body = jsonMapper.writeValueAsString(Map.of("question", question));
        return write(post("/api/live-sessions/" + sessionId + "/ai/answers/stream")
                .accept(MediaType.TEXT_EVENT_STREAM), auth, body);
    }

    /** 세션 시작 + 커리큘럼 발행. {sessionId, curriculumId, lessonId} 반환. */
    private String[] createStartedSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"AI Q&A\"}")
                .andReturn()).get("curriculumId").asString();
        write(post("/api/instructor/curriculums/" + cid + "/publish"), auth, null).andExpect(status().isOk());
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"s\"}")
                .andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"l\"}")
                .andReturn()).get("lessonId").asString();
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null)
                .andReturn()).get("sessionId").asString();
        String instructorId = json(mockMvc.perform(get("/api/auth/me").cookie(auth)).andReturn())
                .get("userId").asString();
        LiveStartTestSupport.stubInstructorPublishing(roomControl, sessionId, instructorId);
        LiveStartTestSupport.stubRecordingReady(recordingControl);
        LiveStartTestSupport.stubAgentDispatched(agentDispatchControl);
        write(post("/api/live-sessions/" + sessionId + "/start"), auth, null).andExpect(status().isAccepted());
        startOrchestrator.runStartGates(UUID.fromString(sessionId));
        return new String[]{sessionId, cid, lessonId};
    }

    private void enrollActive(String cid, Cookie[] student, Cookie[] instructor) throws Exception {
        String eid = json(write(post("/api/curriculums/" + cid + "/enrollments"), student, null)
                .andReturn()).get("enrollmentId").asString();
        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve"), instructor, null)
                .andExpect(status().isOk());
    }

    private org.springframework.test.web.servlet.ResultActions write(
            MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body) throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = json(csrf);
        List<Cookie> cookies = new ArrayList<>();
        cookies.add(csrf.getResponse().getCookie("XSRF-TOKEN"));
        if (authCookies != null) {
            cookies.addAll(List.of(authCookies));
        }
        builder = builder.cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder = builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "ai-qna-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn();
        return login.getResponse().getCookies();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
