package com.liveclass.live;

import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.live.config.CaptionStreamProperties;
import com.liveclass.live.repository.LiveSessionRepository;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.CaptionEvent;
import com.liveclass.live.service.LiveCaptionService;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.support.LiveStartTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.simp.stomp.StompFrameHandler;
import org.springframework.messaging.simp.stomp.StompHeaders;
import org.springframework.messaging.simp.stomp.StompSession;
import org.springframework.messaging.simp.stomp.StompSessionHandlerAdapter;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.messaging.WebSocketStompClient;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.lang.reflect.Type;
import java.net.CookieManager;
import java.net.CookiePolicy;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.OffsetDateTime;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 자막 WS 전달 계약 테스트(POLICY: 자막 전달 핵심경로 + 구독 인가, ADR-0043). Redis Stream에 XADD한
 * caption.delta가 소비→영속(AFTER_COMMIT)→STOMP 브로드캐스트로 이어지는 왕복을 실제 서버로 확인한다:
 * <ul>
 *   <li>봉투 형태·목적지: {@code /topic/live-sessions/{id}/captions}, type=caption.delta,
 *       payload={sttSessionId,sequence,streamElapsedMs(raw),text}.</li>
 *   <li>구독 인가: 비참가자의 captions 구독은 거부되어 자막을 수신하지 못한다(와일드카드 차단 불변식 유지).</li>
 * </ul>
 * consumer는 격리된 stream-key/group으로 재활성화한다(기본은 테스트에서 off).
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "liveclass.ws.allowed-origin-patterns=*",
        "liveclass.caption.enabled=true",
        "liveclass.caption.stream-key=ai:captions:test:ws",
        "liveclass.caption.group=spring-caption-test-ws",
        "liveclass.caption.consumer=ws-1"
})
class LiveCaptionWebSocketTest {

    @LocalServerPort
    private int port;

    @Autowired
    private LiveSessionRepository liveSessionRepository;

    @Autowired
    private StringRedisTemplate redis;

    @Autowired
    private CaptionStreamProperties captionProperties;

    @Autowired
    private LiveCaptionService liveCaptionService;

    @MockitoBean
    private LiveRoomControl roomControl;

    @MockitoBean
    private LiveRecordingControl recordingControl;

    @MockitoBean
    private AgentDispatchControl agentDispatchControl;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void caption_delta_from_redis_is_broadcast_to_captions_subscribers() throws Exception {
        Client instructor = new Client();
        instructor.signupAndLogin("INSTRUCTOR");
        String[] ids = instructor.createStartedSession();
        String lessonId = ids[0];
        String sessionId = ids[1];
        String cid = ids[2];

        Client student = new Client();
        student.signupAndLogin("STUDENT");
        String eid = student.field(student.post("/api/curriculums/" + cid + "/enrollments", null), "enrollmentId");
        instructor.post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve", null);

        BlockingQueue<Map<String, Object>> received = new LinkedBlockingQueue<>();
        StompSession session = connect(student);
        subscribeCaptions(session, sessionId, received);
        Thread.sleep(300);   // 구독이 브로커에 반영될 시간

        // occurredAt을 세션 클록 원점 + 41s로 둬 근사 세션-ms(occurredAt−clockOriginAt)가 결정론적으로 41000이 되게 한다.
        OffsetDateTime clockOrigin = liveSessionRepository.findById(UUID.fromString(sessionId)).orElseThrow()
                .getClockOriginAt();
        String occurredAt = clockOrigin.plusSeconds(41).toString();
        redis.opsForStream().add(captionProperties.streamKey(), delta(sessionId, lessonId, occurredAt));

        Map<String, Object> envelope = received.poll(15, TimeUnit.SECONDS);
        assertThat(envelope).as("자막 브로드캐스트를 시간 내 수신").isNotNull();
        assertThat(envelope.get("type")).isEqualTo("caption.delta");
        assertThat(envelope.get("sessionId")).isEqualTo(sessionId);

        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) envelope.get("payload");
        assertThat(payload.get("sttSessionId")).isEqualTo("openai-realtime:session-ws");
        assertThat(payload.get("sequence")).isEqualTo(1);
        assertThat(payload.get("streamElapsedMs")).isEqualTo(41000);   // raw ms 그대로(변환 금지)
        assertThat(payload.get("text")).isEqualTo("실시간 자막");
        // 근사 세션-ms(occurredAt−clockOriginAt, ADR-0045)를 표시용으로 함께 싣는다 — streamElapsedMs 변환이 아니다.
        assertThat(payload.get("sessionMs")).isEqualTo(41000);

        session.disconnect();
    }

    @Test
    void subscribing_to_captions_without_enrollment_is_blocked() throws Exception {
        Client instructor = new Client();
        instructor.signupAndLogin("INSTRUCTOR");
        String[] ids = instructor.createStartedSession();
        String lessonId = ids[0];
        String sessionId = ids[1];
        String cid = ids[2];

        // 통제군: 활성 수강생 — 자막 수신되어야.
        Client enrolled = new Client();
        enrolled.signupAndLogin("STUDENT");
        String eid = enrolled.field(enrolled.post("/api/curriculums/" + cid + "/enrollments", null), "enrollmentId");
        instructor.post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve", null);

        // 공격자: 미수강 — captions 구독이 거부되어야 한다.
        Client outsider = new Client();
        outsider.signupAndLogin("STUDENT");

        BlockingQueue<Map<String, Object>> enrolledInbox = new LinkedBlockingQueue<>();
        BlockingQueue<Map<String, Object>> outsiderInbox = new LinkedBlockingQueue<>();

        StompSession enrolledSession = connect(enrolled);
        StompSession outsiderSession = connect(outsider);
        subscribeCaptions(enrolledSession, sessionId, enrolledInbox);
        subscribeCaptions(outsiderSession, sessionId, outsiderInbox);
        Thread.sleep(400);

        redis.opsForStream().add(captionProperties.streamKey(), delta(sessionId, lessonId, "2026-08-01T10:00:41Z"));

        assertThat(enrolledInbox.poll(15, TimeUnit.SECONDS))
                .as("활성 수강생은 자막을 수신한다").isNotNull();
        assertThat(outsiderInbox.poll(2, TimeUnit.SECONDS))
                .as("미수강자는 구독이 거부돼 자막을 수신하지 못한다").isNull();

        if (enrolledSession.isConnected()) {
            enrolledSession.disconnect();
        }
        if (outsiderSession.isConnected()) {
            outsiderSession.disconnect();
        }
    }

    @Test
    void reload_returns_stored_captions_in_session_ms_order_with_approx_session_ms() throws Exception {
        Client instructor = new Client();
        instructor.signupAndLogin("INSTRUCTOR");
        String[] ids = instructor.createStartedSession();
        String lessonId = ids[0];
        String sessionId = ids[1];
        String cid = ids[2];

        Client student = new Client();
        student.signupAndLogin("STUDENT");
        String eid = student.field(student.post("/api/curriculums/" + cid + "/enrollments", null), "enrollmentId");
        instructor.post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve", null);

        // 저장된 자막 한 줄을 직접 적재한다. occurredAt = clockOriginAt + 5s → 근사 sessionMs=5000(결정론적).
        OffsetDateTime clockOrigin = liveSessionRepository.findById(UUID.fromString(sessionId)).orElseThrow()
                .getClockOriginAt();
        liveCaptionService.persist(new CaptionEvent(
                "reload-" + UUID.randomUUID(), "caption.delta",
                UUID.fromString(sessionId), UUID.fromString(lessonId),
                "openai-realtime:reload", 1L, null, 41000, "복원될 자막", null,
                clockOrigin.plusSeconds(5)));

        HttpResponse<String> res = student.get("/api/live-sessions/" + sessionId + "/captions");
        assertThat(res.statusCode()).as("참가자는 자막 리로드를 조회한다").isEqualTo(200);

        JsonNode items = jsonMapper.readTree(res.body());
        assertThat(items.isArray()).isTrue();
        assertThat(items.size()).isEqualTo(1);
        JsonNode item = items.get(0);
        assertThat(item.get("type").asString()).isEqualTo("caption.delta");
        assertThat(item.get("sttSessionId").asString()).isEqualTo("openai-realtime:reload");
        assertThat(item.get("sequence").asLong()).isEqualTo(1L);
        assertThat(item.get("streamElapsedMs").asLong()).isEqualTo(41000L);   // raw 그대로
        assertThat(item.get("sessionMs").asLong()).isEqualTo(5000L);          // 근사(occurredAt−clockOriginAt)
        assertThat(item.get("text").asString()).isEqualTo("복원될 자막");
    }

    @Test
    void reload_is_forbidden_for_non_participant() throws Exception {
        Client instructor = new Client();
        instructor.signupAndLogin("INSTRUCTOR");
        String[] ids = instructor.createStartedSession();
        String sessionId = ids[1];

        Client outsider = new Client();
        outsider.signupAndLogin("STUDENT");   // 미수강

        HttpResponse<String> res = outsider.get("/api/live-sessions/" + sessionId + "/captions");
        assertThat(res.statusCode()).as("미참가자는 자막 리로드가 403").isEqualTo(403);
    }

    private Map<String, String> delta(String sessionId, String lessonId, String occurredAt) {
        Map<String, String> delta = new LinkedHashMap<>();
        delta.put("contractVersion", "1");
        delta.put("type", "caption.delta");
        delta.put("eventId", "ws-caption-" + UUID.randomUUID());
        delta.put("sessionId", sessionId);
        delta.put("lessonId", lessonId);
        delta.put("sttSessionId", "openai-realtime:session-ws");
        delta.put("sequence", "1");
        delta.put("streamElapsedMs", "41000");
        delta.put("text", "실시간 자막");
        delta.put("occurredAt", occurredAt);
        return delta;
    }

    private StompSession connect(Client client) throws Exception {
        WebSocketStompClient stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new JacksonJsonMessageConverter());
        WebSocketHttpHeaders handshake = new WebSocketHttpHeaders();
        handshake.add("Cookie", client.cookieHeader());
        return stompClient.connectAsync("ws://localhost:" + port + "/api/ws", handshake, new StompHeaders(),
                new StompSessionHandlerAdapter() {}).get(10, TimeUnit.SECONDS);
    }

    private void subscribeCaptions(StompSession session, String sessionId, BlockingQueue<Map<String, Object>> inbox) {
        session.subscribe("/topic/live-sessions/" + sessionId + "/captions", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return Map.class;
            }

            @Override
            @SuppressWarnings("unchecked")
            public void handleFrame(StompHeaders headers, Object payload) {
                inbox.add((Map<String, Object>) payload);
            }
        });
    }

    /** 쿠키 세션을 유지하는 최소 HTTP 클라이언트(CSRF 핸드셰이크 포함). LiveChatWebSocketTest와 동형. */
    private final class Client {
        private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        private final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies).build();

        void signupAndLogin(String role) throws Exception {
            String email = "cap-" + UUID.randomUUID() + "@liveclass.test";
            post("/api/auth/signup", """
                    {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                    """.formatted(email, role));
            post("/api/auth/login", """
                    {"email":"%s","password":"password123"}
                    """.formatted(email));
        }

        String[] createStartedSession() throws Exception {
            String cid = field(post("/api/instructor/curriculums", "{\"title\":\"cap\"}"), "curriculumId");
            post("/api/instructor/curriculums/" + cid + "/publish", null);
            String sid = field(post("/api/instructor/curriculums/" + cid + "/sections", "{\"title\":\"s\"}"), "sectionId");
            String lessonId = field(post("/api/instructor/sections/" + sid + "/lessons", "{\"title\":\"l\"}"), "lessonId");
            String sessionId = field(post("/api/instructor/lessons/" + lessonId + "/live-sessions", null), "sessionId");
            String instructorId = field(get("/api/auth/me"), "userId");
            LiveStartTestSupport.stubInstructorPublishing(roomControl, sessionId, instructorId);
            LiveStartTestSupport.stubRecordingReady(recordingControl);
            LiveStartTestSupport.stubAgentDispatched(agentDispatchControl);
            post("/api/live-sessions/" + sessionId + "/start", null);
            LiveStartTestSupport.awaitLive(liveSessionRepository, sessionId);
            return new String[]{lessonId, sessionId, cid};
        }

        HttpResponse<String> get(String path) throws Exception {
            HttpRequest req = HttpRequest.newBuilder(URI.create(base() + path)).GET().build();
            return http.send(req, HttpResponse.BodyHandlers.ofString());
        }

        HttpResponse<String> post(String path, String body) throws Exception {
            String[] csrf = csrf();
            HttpRequest.Builder b = HttpRequest.newBuilder(URI.create(base() + path))
                    .header(csrf[0], csrf[1])
                    .header("Content-Type", "application/json");
            b = (body == null)
                    ? b.POST(HttpRequest.BodyPublishers.noBody())
                    : b.POST(HttpRequest.BodyPublishers.ofString(body));
            return http.send(b.build(), HttpResponse.BodyHandlers.ofString());
        }

        private String[] csrf() throws Exception {
            JsonNode json = jsonMapper.readTree(get("/api/auth/csrf").body());
            return new String[]{json.get("headerName").asString(), json.get("token").asString()};
        }

        private String field(HttpResponse<String> res, String name) {
            return jsonMapper.readTree(res.body()).get(name).asString();
        }

        String cookieHeader() {
            StringBuilder sb = new StringBuilder();
            cookies.getCookieStore().getCookies().forEach(c -> {
                if (!sb.isEmpty()) {
                    sb.append("; ");
                }
                sb.append(c.getName()).append('=').append(c.getValue());
            });
            return sb.toString();
        }

        private String base() {
            return "http://localhost:" + port;
        }
    }
}
