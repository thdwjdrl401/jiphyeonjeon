package com.liveclass.live;

import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.live.repository.LiveSessionRepository;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.support.LiveStartTestSupport;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.messaging.converter.JacksonJsonMessageConverter;
import org.springframework.messaging.simp.stomp.StompCommand;
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
 *   <li>{@code ENDED} 뒤에도 같은 채팅 경로로 후속 토론을 이어갈 수 있다.</li>
 *   <li>브로드캐스트 payload에 실명·userId가 없다(가명만).</li>
 *   <li>WS로 보낸 메시지가 REST GET으로도 복구된다(같은 저장 경로).</li>
 * </ul>
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
        properties = "liveclass.ws.allowed-origin-patterns=*")
class LiveChatWebSocketTest {

    @LocalServerPort
    private int port;

    @Autowired
    private LiveSessionRepository liveSessionRepository;

    @MockitoBean
    private LiveRoomControl roomControl;

    @MockitoBean
    private LiveRecordingControl recordingControl;

    @MockitoBean
    private AgentDispatchControl agentDispatchControl;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void student_ws_message_is_broadcast_to_subscribers_without_identity() throws Exception {
        Client instructor = new Client();
        instructor.signupAndLogin("INSTRUCTOR");
        String[] ids = instructor.createStartedSession();
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

        // 익명은 발신자 선택이다(ADR-0050) — WS 경로도 REST와 같은 command DTO를 쓰므로 여기서 켜서
        // 브로드캐스트 payload가 가명만 싣는지(표시 이름 유출 없음) 확인한다.
        session.send("/app/live-sessions/" + sessionId + "/chat",
                Map.of("clientMessageId", "ws-1", "text", "실시간이다", "isQuestion", true, "anonymous", true));

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
        HttpResponse<String> list = student.get("/api/live-sessions/" + sessionId + "/messages");
        assertThat(list.statusCode()).isEqualTo(200);
        JsonNode arr = jsonMapper.readTree(list.body());
        assertThat(arr.size()).isEqualTo(1);
        assertThat(arr.get(0).get("text").asString()).isEqualTo("실시간이다");
        assertThat(arr.get(0).get("mine").asBoolean()).isTrue();   // 보낸 학생 본인 → mine
    }

    @Test
    void subscribing_to_chat_without_enrollment_is_blocked() throws Exception {
        Client instructor = new Client();
        instructor.signupAndLogin("INSTRUCTOR");
        String[] ids = instructor.createStartedSession();
        String sessionId = ids[1];
        String cid = ids[2];

        // 통제군: 활성 수강생 — 구독 허용·수신되어야 게이트가 "정상은 통과"시킴을 증명한다.
        Client enrolled = new Client();
        enrolled.signupAndLogin("STUDENT");
        String eid = enrolled.field(enrolled.post("/api/curriculums/" + cid + "/enrollments", null), "enrollmentId");
        instructor.post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve", null);

        // 공격자: 수강 신청 안 함 — 구독이 인가 인터셉터에서 거부되어야 한다.
        Client outsider = new Client();
        outsider.signupAndLogin("STUDENT");

        BlockingQueue<Map<String, Object>> enrolledInbox = new LinkedBlockingQueue<>();
        BlockingQueue<Map<String, Object>> outsiderInbox = new LinkedBlockingQueue<>();

        BlockingQueue<String> outsiderRejections = new LinkedBlockingQueue<>();
        StompSession enrolledSession = connect(enrolled);
        StompSession outsiderSession = connect(outsider, outsiderRejections);
        subscribeChat(enrolledSession, sessionId, enrolledInbox);
        subscribeChat(outsiderSession, sessionId, outsiderInbox);

        // 서버가 미수강자의 SUBSCRIBE를 실제로 <b>거부</b>했는지 먼저 확인한다. 이게 없으면 아래
        // "수신 없음"은 게이트가 뚫렸는데 구독이 늦게 등록돼 조용한 경우와 구별되지 않는다.
        assertThat(outsiderRejections.poll(10, TimeUnit.SECONDS))
                .as("서버가 미수강자의 구독을 능동적으로 거부한다(ERROR 프레임)").isNotNull();

        // 활성 수강생이 채팅을 보낸다(전송은 컨트롤러 게이트를 통과).
        enrolledSession.send("/app/live-sessions/" + sessionId + "/chat",
                Map.of("clientMessageId", "gate-1", "text", "수강생만 보여야", "isQuestion", false));

        // 활성 수강생은 실시간으로 받는다.
        assertThat(enrolledInbox.poll(10, TimeUnit.SECONDS))
                .as("활성 수강생은 채팅을 수신한다").isNotNull();
        // 미수강자는 구독이 거부돼 같은 브로드캐스트를 받지 못한다.
        assertThat(outsiderInbox.poll(2, TimeUnit.SECONDS))
                .as("미수강자는 구독이 거부돼 실시간 채팅을 수신하지 못한다").isNull();

        // 미수강자 세션은 구독 거부(ERROR 프레임)로 이미 서버가 닫았을 수 있으니 방어적으로 정리한다.
        if (enrolledSession.isConnected()) {
            enrolledSession.disconnect();
        }
        if (outsiderSession.isConnected()) {
            outsiderSession.disconnect();
        }
    }

    @Test
    void wildcard_subscription_to_chat_topics_is_rejected() throws Exception {
        Client instructor = new Client();
        instructor.signupAndLogin("INSTRUCTOR");
        String[] ids = instructor.createStartedSession();
        String sessionId = ids[1];
        String cid = ids[2];

        // 통제군: 구체적 채팅 토픽을 구독한 활성 수강생 — 수신되어야.
        Client enrolled = new Client();
        enrolled.signupAndLogin("STUDENT");
        String eid = enrolled.field(enrolled.post("/api/curriculums/" + cid + "/enrollments", null), "enrollmentId");
        instructor.post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve", null);

        // 공격자: 활성 수강생이지만(!) 와일드카드로 구독을 시도한다. 브로커는 구독을 패턴 매칭하므로
        // 이게 통하면 게이트 우회가 된다 → 구체 토픽이 아니라 거부되어 아무것도 못 받아야 한다.
        Client wildcardAttempt = new Client();
        wildcardAttempt.signupAndLogin("STUDENT");
        String eid2 = wildcardAttempt.field(
                wildcardAttempt.post("/api/curriculums/" + cid + "/enrollments", null), "enrollmentId");
        instructor.post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid2 + "/approve", null);

        BlockingQueue<Map<String, Object>> enrolledInbox = new LinkedBlockingQueue<>();
        BlockingQueue<Map<String, Object>> wildcardInbox = new LinkedBlockingQueue<>();

        BlockingQueue<String> wildcardRejections = new LinkedBlockingQueue<>();
        StompSession enrolledSession = connect(enrolled);
        StompSession wildcardSession = connect(wildcardAttempt, wildcardRejections);
        subscribeChat(enrolledSession, sessionId, enrolledInbox);
        wildcardSession.subscribe("/topic/live-sessions/*/chat", frameHandler(wildcardInbox));   // 와일드카드

        // 위와 같은 이유 — 패턴 구독이 실제로 거부됐음을 먼저 못 박는다.
        assertThat(wildcardRejections.poll(10, TimeUnit.SECONDS))
                .as("서버가 와일드카드 구독을 능동적으로 거부한다(ERROR 프레임)").isNotNull();

        enrolledSession.send("/app/live-sessions/" + sessionId + "/chat",
                Map.of("clientMessageId", "wc-1", "text", "패턴 구독은 차단", "isQuestion", false));

        assertThat(enrolledInbox.poll(10, TimeUnit.SECONDS))
                .as("구체 토픽을 구독한 활성 수강생은 수신한다").isNotNull();
        assertThat(wildcardInbox.poll(2, TimeUnit.SECONDS))
                .as("와일드카드 구독은 수강 여부와 무관하게 거부되어 수신이 없다").isNull();

        if (enrolledSession.isConnected()) {
            enrolledSession.disconnect();
        }
        if (wildcardSession.isConnected()) {
            wildcardSession.disconnect();
        }
    }

    @Test
    void ending_and_ended_are_broadcast_and_ended_still_allows_chat() throws Exception {
        Client instructor = new Client();
        instructor.signupAndLogin("INSTRUCTOR");
        String[] ids = instructor.createStartedSession();
        String sessionId = ids[1];

        Client student = new Client();
        student.signupAndLogin("STUDENT");
        String enrollmentId = student.field(
                student.post("/api/curriculums/" + ids[2] + "/enrollments", null),
                "enrollmentId");
        instructor.post(
                "/api/instructor/curriculums/" + ids[2] + "/enrollments/" + enrollmentId + "/approve",
                null);

        BlockingQueue<Map<String, Object>> stateInbox = new LinkedBlockingQueue<>();
        BlockingQueue<Map<String, Object>> chatInbox = new LinkedBlockingQueue<>();
        StompSession stateSession = connect(student);
        stateSession.subscribe(
                "/topic/live-sessions/" + sessionId + "/state",
                frameHandler(stateInbox));
        subscribeChat(stateSession, sessionId, chatInbox);
        Thread.sleep(300);

        HttpResponse<String> end = instructor.post("/api/live-sessions/" + sessionId + "/end", null);
        assertThat(end.statusCode()).isEqualTo(200);

        Map<String, Object> ending = stateInbox.poll(10, TimeUnit.SECONDS);
        Map<String, Object> ended = stateInbox.poll(10, TimeUnit.SECONDS);
        assertThat(ending).isNotNull();
        assertThat(ended).isNotNull();
        assertThat(ending.get("type")).isEqualTo("session.ending");
        assertThat(ended.get("type")).isEqualTo("session.ended");

        @SuppressWarnings("unchecked")
        Map<String, Object> endingPayload = (Map<String, Object>) ending.get("payload");
        @SuppressWarnings("unchecked")
        Map<String, Object> endedPayload = (Map<String, Object>) ended.get("payload");
        assertThat(endingPayload.get("liveSessionStatus")).isEqualTo("ENDING");
        assertThat(endingPayload.get("endedAt")).isNull();
        assertThat(endedPayload.get("liveSessionStatus")).isEqualTo("ENDED");
        assertThat(endedPayload.get("endedAt")).isNotNull();

        stateSession.send("/app/live-sessions/" + sessionId + "/chat",
                Map.of("clientMessageId", "ended-chat-1", "text", "수업 끝나고 질문합니다", "isQuestion", true));
        Map<String, Object> endedChat = chatInbox.poll(10, TimeUnit.SECONDS);
        assertThat(endedChat).as("ENDED 뒤 채팅 브로드캐스트를 시간 내 수신").isNotNull();
        assertThat(endedChat.get("type")).isEqualTo("chat.message.created");
        @SuppressWarnings("unchecked")
        Map<String, Object> endedChatPayload = (Map<String, Object>) endedChat.get("payload");
        assertThat(endedChatPayload.get("clientMessageId")).isEqualTo("ended-chat-1");
        assertThat(endedChatPayload.get("text")).isEqualTo("수업 끝나고 질문합니다");

        stateSession.disconnect();
    }

    private StompSession connect(Client client) throws Exception {
        return connect(client, new LinkedBlockingQueue<>());
    }

    /**
     * {@code rejections}에 서버가 보낸 ERROR 프레임을 모은다.
     *
     * <p>구독 인가를 "아무것도 안 왔다"로만 검증하면 <b>게이트가 뚫려도 통과</b>할 수 있다 — 공격자의
     * SUBSCRIBE가 브로드캐스트보다 늦게 등록되면 받을 게 없어서 큐가 비기 때문이다. 지금까지 그 순서를
     * {@code Thread.sleep(400)} 하나로 기대고 있었다. 서버가 <b>능동적으로 거부했다</b>는 증거(ERROR
     * 프레임)를 함께 확인하면, 늦게 등록돼 우연히 조용한 경우와 실제로 막힌 경우가 구별된다.
     */
    private StompSession connect(Client client, BlockingQueue<String> rejections) throws Exception {
        WebSocketStompClient stompClient = new WebSocketStompClient(new StandardWebSocketClient());
        stompClient.setMessageConverter(new JacksonJsonMessageConverter());
        WebSocketHttpHeaders handshake = new WebSocketHttpHeaders();
        handshake.add("Cookie", client.cookieHeader());
        return stompClient.connectAsync("ws://localhost:" + port + "/api/ws", handshake, new StompHeaders(),
                new StompSessionHandlerAdapter() {
                    @Override
                    public void handleException(StompSession session, StompCommand command,
                                                StompHeaders headers, byte[] payload, Throwable exception) {
                        rejections.add(String.valueOf(exception.getMessage()));
                    }

                    @Override
                    public void handleTransportError(StompSession session, Throwable exception) {
                        rejections.add(String.valueOf(exception.getMessage()));
                    }
                }).get(10, TimeUnit.SECONDS);
    }

    private void subscribeChat(StompSession session, String sessionId, BlockingQueue<Map<String, Object>> inbox) {
        session.subscribe("/topic/live-sessions/" + sessionId + "/chat", frameHandler(inbox));
    }

    private StompFrameHandler frameHandler(BlockingQueue<Map<String, Object>> inbox) {
        return new StompFrameHandler() {
            @Override
            public Type getPayloadType(StompHeaders headers) {
                return Map.class;
            }

            @Override
            @SuppressWarnings("unchecked")
            public void handleFrame(StompHeaders headers, Object payload) {
                inbox.add((Map<String, Object>) payload);
            }
        };
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
            String sid = field(post("/api/instructor/curriculums/" + cid + "/sections", "{\"title\":\"s\"}"), "sectionId");
            String lessonId = field(post("/api/instructor/sections/" + sid + "/lessons", "{\"title\":\"l\"}"), "lessonId");
            // 게시는 섹션·강의가 생긴 뒤에 한다 — 게시 선행 조건(ADR-0006).
            post("/api/instructor/curriculums/" + cid + "/publish", null);
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
