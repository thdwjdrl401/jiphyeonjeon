package com.liveclass.live;

import com.liveclass.live.service.LiveRoomControl;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
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
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 실시간 채팅 WebSocket 계약 검증(ADR-0019, LIVE.md §8). 실제 서버를 띄우고 쿠키 세션으로 STOMP
 * 핸드셰이크 → 구독 → 전송 → 브로드캐스트 왕복을 확인한다. 핵심:
 * <ul>
 *   <li>학생이 {@code /app/live-sessions/{id}/chat}로 보내면 구독자가 {@code chat.message.created}를 받는다.</li>
 *   <li>브로드캐스트 payload에 실명·userId가 없다(가명만).</li>
 *   <li>WS로 보낸 메시지가 REST GET으로도 복구된다(같은 저장 경로).</li>
 * </ul>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "liveclass.ws.allowed-origin-patterns=*")
class LiveChatWebSocketTest {

    @LocalServerPort
    private int port;

    // start()는 방 제어를 부르지 않지만 안전하게 목으로 둔다(다른 라이브 테스트와 동일).
    @MockitoBean
    private LiveRoomControl roomControl;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void student_ws_message_is_broadcast_to_subscribers_without_identity() throws Exception {
        Client instructor = new Client();
        instructor.signupAndLogin("INSTRUCTOR");
        String[] ids = instructor.createStartedSession();
        String lessonId = ids[0];
        String sessionId = ids[1];

        Client student = new Client();
        student.signupAndLogin("STUDENT");
        // 활성 수강생이어야 채팅 게이트를 통과한다: 신청 → 강사 승인.
        String cid = ids[2];
        String eid = student.field(student.post("/api/curriculums/" + cid + "/enrollments", null), "enrollmentId");
        instructor.post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve", null);

        WebSocketStompClient stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new JacksonJsonMessageConverter());

        WebSocketHttpHeaders handshake = new WebSocketHttpHeaders();
        handshake.add("Cookie", student.cookieHeader());

        StompSession session = stompClient
                .connectAsync("ws://localhost:" + port + "/api/ws", handshake, new StompHeaders(),
                        new StompSessionHandlerAdapter() {})
                .get(10, TimeUnit.SECONDS);

        BlockingQueue<Map<String, Object>> received = new LinkedBlockingQueue<>();
        session.subscribe("/topic/live-sessions/" + sessionId + "/chat", new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return Map.class;
            }

            @Override
            @SuppressWarnings("unchecked")
            public void handleFrame(StompHeaders headers, Object payload) {
                received.add((Map<String, Object>) payload);
            }
        });
        // 구독 등록이 브로커에 반영될 시간을 준다(전송 전에 활성화돼야 브로드캐스트를 놓치지 않음).
        Thread.sleep(300);

        session.send("/app/live-sessions/" + sessionId + "/chat",
                Map.of("clientMessageId", "ws-1", "text", "실시간이다", "isQuestion", true));

        Map<String, Object> envelope = received.poll(10, TimeUnit.SECONDS);
        assertThat(envelope).as("브로드캐스트를 시간 내 수신").isNotNull();
        assertThat(envelope.get("type")).isEqualTo("chat.message.created");
        assertThat(envelope.get("sessionId")).isEqualTo(sessionId);

        @SuppressWarnings("unchecked")
        Map<String, Object> payload = (Map<String, Object>) envelope.get("payload");
        assertThat(payload.get("text")).isEqualTo("실시간이다");
        assertThat(payload.get("isQuestion")).isEqualTo(true);
        assertThat(payload.get("clientMessageId")).isEqualTo("ws-1");
        assertThat((String) payload.get("alias")).startsWith("수강생-");
        // 프라이버시: payload 어디에도 userId·실명이 없어야 한다.
        assertThat(payload).doesNotContainKey("userId");
        assertThat(payload.values()).doesNotContain("테스터");

        session.disconnect();
        stompClient.stop();

        // WS로 보낸 메시지가 REST GET으로도 복구된다(같은 저장 경로).
        HttpResponse<String> list = student.get("/api/lessons/" + lessonId + "/messages");
        assertThat(list.statusCode()).isEqualTo(200);
        JsonNode arr = jsonMapper.readTree(list.body());
        assertThat(arr.size()).isEqualTo(1);
        assertThat(arr.get(0).get("text").asString()).isEqualTo("실시간이다");
        assertThat(arr.get(0).get("mine").asBoolean()).isTrue();   // 보낸 학생 본인 → mine
    }

    /** 쿠키 세션을 유지하는 최소 HTTP 클라이언트(CSRF 핸드셰이크 포함). */
    private final class Client {
        private final CookieManager cookies = new CookieManager(null, CookiePolicy.ACCEPT_ALL);
        private final HttpClient http = HttpClient.newBuilder().cookieHandler(cookies).build();

        void signupAndLogin(String role) throws Exception {
            String email = "ws-" + UUID.randomUUID() + "@liveclass.test";
            post("/api/auth/signup", """
                    {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                    """.formatted(email, role));
            post("/api/auth/login", """
                    {"email":"%s","password":"password123"}
                    """.formatted(email));
        }

        /** 강사로 커리큘럼→섹션→레슨→라이브세션 생성·발행·시작. {lessonId, sessionId, curriculumId} 반환. */
        String[] createStartedSession() throws Exception {
            String cid = field(post("/api/instructor/curriculums", "{\"title\":\"ws\"}"), "curriculumId");
            post("/api/instructor/curriculums/" + cid + "/publish", null);
            String sid = field(post("/api/instructor/curriculums/" + cid + "/sections", "{\"title\":\"s\"}"), "sectionId");
            String lessonId = field(post("/api/instructor/sections/" + sid + "/lessons", "{\"title\":\"l\"}"), "lessonId");
            String sessionId = field(post("/api/instructor/lessons/" + lessonId + "/live-sessions", null), "sessionId");
            post("/api/live-sessions/" + sessionId + "/start", null);
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

        /** GET /api/auth/csrf → {headerName, token}. */
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
