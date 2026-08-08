package com.liveclass.video;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.liveclass.live.api.LiveKitServerAccess;
import com.liveclass.live.domain.LiveCaption;
import com.liveclass.live.repository.LiveCaptionRepository;
import com.liveclass.live.repository.LiveSessionRepository;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.support.LiveStartTestSupport;
import com.liveclass.video.domain.ReplayStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.service.EgressControl;
import com.liveclass.video.service.S3RecordingStorage;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.webmvc.test.autoconfigure.MockMvcPrint;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 다시보기 AI 질의응답 SSE 프록시 계약(ADR-0042 · ADR-0075).
 *
 * <p>ai-api를 목 HTTP 서버로 세워 <b>실제 ai-api 없이</b> 다음을 고정한다.
 * <ul>
 *   <li>경로·서명: {@code /internal/v2/rag/answers:stream} + 우리가 실제로 보낸 원시 body의 HMAC</li>
 *   <li>body: 최상위 7필드(v1의 {@code contextTimeMs} 자리에 {@code context})·소문자 canonical UUID</li>
 *   <li>자막 문맥: attempt 앵커를 적용한 <b>세션 상대 ms</b>, 질문 시점 이후 발화는 빠짐</li>
 *   <li>인가: 재생 게이트와 동일 — 미수강 403, 학생·미게시 404, 소유 강사는 게시 전에도 가능</li>
 *   <li>에러 매핑: 라이브와 <b>같은 코드</b>(503·409·502)</li>
 * </ul>
 *
 * <p><b>이 테스트만으로는 부족하다.</b> 여기는 우리가 보내는 것만 고정한다 — ai-api가 v2 필수 필드를
 * 늘리면 이 테스트는 통과한 채로 운영이 400을 맞는다(v1에서 {@code curriculumId}로 실제 겪었다).
 * 정본은 {@code ai/ai-api/CONTRACT.md §8}이고 그쪽이 바뀌면 여기도 같이 고쳐야 한다.
 *
 * <p><b>{@code print = NONE}인 이유</b>: SSE 응답은 컨트롤러가 반환한 뒤에도 릴레이 스레드가 계속 쓴다.
 * Boot 기본 출력 핸들러는 매 요청마다 응답 헤더를 읽는데, 그 사이 헤더가 바뀌면 스트림 복사가 깨져
 * {@code "End size 1 is less than fixed size 2"}로 무작위 실패한다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc(print = MockMvcPrint.NONE)
class ReplayAiAnswerContractTest {

    /**
     * 질의만 <b>우리 앱의 실제 포트</b>로 쏘기 위한 값. <b>ai-api는 그대로 목이다</b> —
     * 바뀌는 것은 테스트가 우리 앱을 부르는 방법뿐이고, 외부로 나가는 호출은 없다
     * ({@link #aiApiProperties}가 127.0.0.1 루프백 목을 가리킨다).
     *
     * <p>준비 단계(로그인·커리큘럼 생성·게시)는 그대로 MockMvc를 쓴다 — 세션이 Redis에 있어
     * MockMvc로 받은 쿠키가 실제 포트로 보낸 요청에서도 통한다.
     *
     * <p><b>SSE를 MockMvc로 재면 안 된다.</b> {@code SseEmitter}는 {@code complete()}로 끝나는데
     * MockMvc는 오지 않는 async dispatch를 기다려, 스트리밍 응답마다 기본 타임아웃 10초를 통째로
     * 쓴다. 계측하면 {@code perform=10201ms}인데 그중 SSE 중계는 <b>92ms</b>였다. 이 클래스의
     * 질의 11건이 각각 10초를 버려 132초 중 110초가 순수 대기였다.
     *
     * <p>실제 포트로 받으면 본문이 스트림 종료와 함께 완결되므로, "다 왔는지" 폴링으로 가늠하던
     * {@code awaitSse}·{@code awaitStableBody}도 함께 사라졌다.
     */
    @LocalServerPort
    private int port;

    private static final String SECRET = "test-ai-internal-secret";

    private static final String MANIFEST = """
            #EXTM3U
            #EXT-X-VERSION:3
            #EXT-X-TARGETDURATION:2
            #EXT-X-PLAYLIST-TYPE:VOD
            #EXT-X-PROGRAM-DATE-TIME:2026-07-26T10:00:00.000Z
            #EXTINF:2.0,
            seg_00000.ts
            #EXT-X-ENDLIST
            """;

    private static final String LIVE_MANIFEST = """
            #EXTM3U
            #EXT-X-VERSION:3
            #EXT-X-TARGETDURATION:2
            #EXT-X-MEDIA-SEQUENCE:0
            #EXT-X-PLAYLIST-TYPE:EVENT
            #EXT-X-PROGRAM-DATE-TIME:2026-07-26T10:00:00.000Z
            #EXTINF:2.0,
            seg_00000.ts
            """;

    private static HttpServer aiApi;
    private static final AtomicReference<Responder> responder = new AtomicReference<>();
    private static final AtomicReference<CapturedRequest> captured = new AtomicReference<>();


    private interface Responder {
        void respond(HttpExchange exchange) throws IOException;
    }

    private record CapturedRequest(String path, Map<String, String> headers, byte[] rawBody) {
    }

    @BeforeAll
    static void startAiApi() throws IOException {
        aiApi = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        /*
         * 기본 executor는 교환을 한 스레드에서 <b>차례로</b> 처리한다. SSE 응답은 프레임을 다 쓸 때까지
         * 핸들러가 살아 있으므로, 앞 요청이 끝나기 전에 온 요청이 통째로 밀려 다음 테스트가 타임아웃한다.
         */
        aiApi.setExecutor(Executors.newCachedThreadPool());
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

    @Autowired private MockMvc mockMvc;
    @Autowired private VideoAssetRepository videoAssetRepository;
    @Autowired private LiveSessionRepository liveSessionRepository;
    @Autowired private LiveCaptionRepository liveCaptionRepository;
    @Autowired private LiveKitServerAccess livekit;

    @MockitoBean private EgressControl egressControl;
    @MockitoBean private LiveRoomControl roomControl;
    @MockitoBean private AgentDispatchControl agentDispatchControl;
    @MockitoBean private S3RecordingStorage recordingStorage;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private final List<UUID> createdSessions = new ArrayList<>();

    @BeforeEach
    void resetMock() {
        captured.set(null);
        responder.set(exchange -> sse(exchange,
                "event: answer.done\ndata: {\"requestId\":\"r\",\"sources\":[]}\n\n"));
    }

    @AfterEach
    void cleanup() {
        for (UUID sessionId : createdSessions) {
            liveCaptionRepository.deleteAll(
                    liveCaptionRepository.findBySessionIdAndEventTypeOrderByIdAsc(sessionId, "caption.segment.final"));
            liveCaptionRepository.deleteAll(
                    liveCaptionRepository.findBySessionIdAndEventTypeOrderByIdAsc(sessionId, "caption.stream.started"));
            videoAssetRepository.findByLiveSessionId(sessionId).ifPresent(videoAssetRepository::delete);
        }
        createdSessions.clear();
    }

    // ---- 경로·서명·body 계약 ----

    @Test
    void posts_to_the_v2_path_and_signs_the_exact_raw_body_it_sends() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);

        assertOk(ask(ids[0], instructor, "  방금 설명한 개념은?  ", 30_000));

        CapturedRequest request = awaitRequest();
        // v1(/internal/v1/...)로 가면 ai-api가 시간 의미가 다른 요청을 받는다 — 경로가 계약이다.
        assertThat(request.path()).isEqualTo("/internal/v2/rag/answers:stream");
        assertThat(request.headers().get("X-Internal-Signature")).isEqualTo(hmacBase64(SECRET, request.rawBody()));
        assertThat(request.headers().get("Accept")).contains("text/event-stream");
        assertThat(request.headers().get("Content-Type")).contains("application/json");
    }

    @Test
    void request_body_has_only_the_seven_contract_fields() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);

        long before = System.currentTimeMillis();
        assertOk(ask(ids[0], instructor, "  질문 원문 그대로  ", 735_000));
        long after = System.currentTimeMillis();

        JsonNode body = jsonMapper.readTree(new String(awaitRequest().rawBody(), StandardCharsets.UTF_8));
        // ai-api는 extra="forbid" — 하나라도 늘거나 빠지면 400이다(422가 아니다).
        assertThat(body.size()).isEqualTo(7);
        assertThat(body.has("requestId")).isTrue();
        assertThat(body.has("lessonId")).isTrue();
        assertThat(body.has("curriculumId")).isTrue();
        assertThat(body.has("sessionId")).isTrue();
        assertThat(body.has("question")).isTrue();
        assertThat(body.has("issuedAtMs")).isTrue();
        // v1과 다른 단 한 곳: 좌표 하나(contextTimeMs) 대신 문맥 객체가 간다.
        assertThat(body.has("contextTimeMs")).isFalse();
        assertThat(body.get("context").get("mode").asString()).isEqualTo("REPLAY");
        assertThat(body.get("context").get("questionSessionMs").asLong()).isEqualTo(735_000L);
        assertThat(body.get("context").has("captions")).isTrue();

        // 서버가 채운 값들. 클라는 질문과 재생 위치만 보냈다.
        assertThat(body.get("lessonId").asString()).isEqualTo(ids[0].toLowerCase());
        assertThat(body.get("sessionId").asString()).isEqualTo(ids[1].toLowerCase());
        String curriculumId = body.get("curriculumId").asString();
        assertThat(curriculumId).isEqualTo(UUID.fromString(curriculumId).toString());

        assertThat(body.get("question").asString()).isEqualTo("  질문 원문 그대로  ");
        assertThat(body.get("requestId").asString()).isNotBlank().hasSizeLessThanOrEqualTo(128);
        assertThat(body.get("issuedAtMs").asLong()).isBetween(before, after);
    }

    // ---- 자막 문맥(시간축 변환) ----

    @Test
    void captions_are_converted_to_session_ms_with_the_attempt_anchor() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);
        UUID sessionId = UUID.fromString(ids[1]);
        OffsetDateTime sessionStart = sessionStart(sessionId);

        /*
         * 오디오 축(start/endStreamElapsedMs)과 발화 벽시계를 **일부러 어긋나게** 둔다. 벽시계를 쓰지
         * 않고 옛 공식으로 되돌아가면 값이 달라져 바로 잡힌다.
         */
        saveStarted(sessionId, ids[0], "stt-attempt-1", sessionStart.plusSeconds(5));
        saveSegment(sessionId, ids[0], "stt-attempt-1", 0, 10_000, 12_000, "컨슈머 그룹은",
                sessionStart.plusSeconds(15), sessionStart.plusSeconds(17));
        saveSegment(sessionId, ids[0], "stt-attempt-1", 1, 13_000, 15_000, "메시지를 나눠 처리합니다",
                sessionStart.plusSeconds(18), sessionStart.plusSeconds(20));
        // 질문(세션 25,000ms) 이후에 시작한 발화 — 아직 듣지 않은 말이라 근거가 될 수 없다.
        saveSegment(sessionId, ids[0], "stt-attempt-1", 2, 30_000, 32_000, "다음 주제로 넘어가면",
                sessionStart.plusSeconds(30), sessionStart.plusSeconds(32));

        assertOk(ask(ids[0], instructor, "컨슈머 그룹이 뭐야?", 25_000));

        JsonNode captions = jsonMapper
                .readTree(new String(awaitRequest().rawBody(), StandardCharsets.UTF_8))
                .get("context").get("captions");
        assertThat(captions.size()).isEqualTo(2);
        // 발화 벽시계 − 세션 원점. 오디오 축(10,000)이 아니라 벽시계(15초)를 썼다는 뜻이다.
        assertThat(captions.get(0).get("startSessionMs").asLong()).isEqualTo(15_000L);
        assertThat(captions.get(0).get("endSessionMs").asLong()).isEqualTo(17_000L);
        assertThat(captions.get(0).get("text").asString()).isEqualTo("컨슈머 그룹은");
        assertThat(captions.get(0).get("sttSessionId").asString()).isEqualTo("stt-attempt-1");
        assertThat(captions.get(0).get("segmentIndex").asLong()).isZero();
        assertThat(captions.get(1).get("startSessionMs").asLong()).isEqualTo(18_000L);
    }

    @Test
    void utterances_without_a_speech_clock_are_dropped_instead_of_guessed() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);
        UUID sessionId = UUID.fromString(ids[1]);
        OffsetDateTime sessionStart = sessionStart(sessionId);

        saveSegment(sessionId, ids[0], "stt-attempt-1", 0, 10_000, 12_000, "시각 있는 발화",
                sessionStart.plusSeconds(15), sessionStart.plusSeconds(17));
        // 이 기능 이전에 녹화된 강의. 시각을 지어내느니 근거에서 뺀다(ADR-0042·0107) —
        // 틀린 시각으로 "지금 이 부분"을 고르면 엉뚱한 곳을 인용해 답이 틀린다.
        saveSegment(sessionId, ids[0], "stt-attempt-2", 0, 10_000, 12_000, "시각 없는 발화");

        assertOk(ask(ids[0], instructor, "질문", 25_000));

        JsonNode captions = jsonMapper
                .readTree(new String(awaitRequest().rawBody(), StandardCharsets.UTF_8))
                .get("context").get("captions");
        assertThat(captions.size()).isEqualTo(1);
        assertThat(captions.get(0).get("text").asString()).isEqualTo("시각 있는 발화");
    }

    @Test
    void empty_captions_still_ask_because_materials_alone_can_answer() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);

        assertOk(ask(ids[0], instructor, "자막 없는 강의 질문", 10_000));

        JsonNode captions = jsonMapper
                .readTree(new String(awaitRequest().rawBody(), StandardCharsets.UTF_8))
                .get("context").get("captions");
        // 자막이 없다고 막지 않는다 — PPTX 근거만으로도 답할 수 있다.
        assertThat(captions.isArray()).isTrue();
        assertThat(captions).isEmpty();
    }

    // ---- SSE 릴레이 ----

    @Test
    void relays_ai_api_events_verbatim() throws Exception {
        responder.set(exchange -> sse(exchange,
                "event: answer.delta\ndata: {\"requestId\":\"r-1\",\"text\":\"컨슈머 그룹은 \"}\n\n",
                "event: answer.done\ndata: {\"requestId\":\"r-1\",\"sources\":"
                        + "[{\"type\":\"CAPTION\",\"excerpt\":\"컨슈머 그룹은\",\"startSessionMs\":15000}]}\n\n"));

        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);

        String relayed = assertOk(ask(ids[0], instructor, "컨슈머 그룹?", 20_000));
        assertThat(relayed).contains("answer.done");
        assertThat(relayed).contains("event:answer.delta");
        assertThat(relayed).contains("event:answer.done");
        // v2가 새로 주는 excerpt도 해석하지 않고 그대로 흘린다 — FE가 ai-api 스키마를 그대로 읽는다.
        assertThat(relayed).contains("\"excerpt\":\"컨슈머 그룹은\"");
        assertThat(relayed).doesNotContain("event:answer.error");
    }

    @Test
    void emits_answer_error_when_upstream_ends_without_a_terminal() throws Exception {
        responder.set(exchange -> sse(exchange,
                "event: answer.delta\ndata: {\"requestId\":\"r-3\",\"text\":\"중간에\"}\n\n"));

        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);

        String relayed = assertOk(ask(ids[0], instructor, "끊기는 질문", 20_000));
        assertThat(relayed).contains("answer.error");
        assertThat(relayed).contains("PROXY_STREAM_INCOMPLETE");
        assertThat(relayed).contains("\"retryable\":true");
    }

    // ---- 인가: 재생 게이트와 같아야 한다 ----

    @Test
    void owner_can_ask_before_the_replay_is_published() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);

        // 검수 중인 강사는 게시 전에도 봐야 하고, 볼 수 있으면 물어볼 수 있어야 한다.
        assertOk(ask(ids[0], instructor, "게시 전 검수 질문", 20_000));
        assertThat(awaitRequest()).isNotNull();
    }

    @Test
    void student_without_enrollment_is_forbidden_and_ai_api_is_never_called() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);
        publish(instructor, ids[0]);

        Cookie[] outsider = loginAs("STUDENT");
        assertFailure(ask(ids[0], outsider, "몰래 질문", 20_000), 403, "ENROLLMENT_REQUIRED");

        // 인가 실패 시 업스트림을 부르지 않는다 — 비용도 비용이지만 근거가 새면 안 된다.
        assertThat(captured.get()).isNull();
    }

    @Test
    void enrolled_student_cannot_ask_until_the_replay_is_published() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        Cookie[] student = loginAs("STUDENT");
        String[] ids = createReadyRecording(instructor);
        approveEnrollment(instructor, student, ids[2]);
        // 녹화 완결은 자동 게시까지 간다. 미게시 상태를 보려면 되돌려야 한다(재생 테스트와 같은 방법).
        unpublish(ids[1]);

        assertFailure(ask(ids[0], student, "미게시 다시보기 질문", 20_000), 404, "REPLAY_NOT_FOUND");
        assertThat(captured.get()).isNull();

        publish(instructor, ids[0]);
        assertOk(ask(ids[0], student, "게시 후 질문", 20_000));
        assertThat(awaitRequest()).isNotNull();
    }

    @Test
    void enrolled_student_can_ask_on_a_published_replay() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        Cookie[] student = loginAs("STUDENT");
        String[] ids = createReadyRecording(instructor);
        approveEnrollment(instructor, student, ids[2]);

        assertOk(ask(ids[0], student, "수강생 질문", 20_000));
        assertThat(awaitRequest()).isNotNull();
    }

    @Test
    void unknown_lesson_is_404() throws Exception {
        Cookie[] student = loginAs("STUDENT");
        assertFailure(ask(UUID.randomUUID().toString(), student, "없는 레슨", 0), 404, "LESSON_NOT_FOUND");
    }

    @Test
    void requires_authentication() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);

        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = json(csrf);
        mockMvc.perform(post("/api/lessons/" + ids[0] + "/ai/answers/stream")
                        .cookie(csrf.getResponse().getCookie("XSRF-TOKEN"))
                        .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"question\":\"익명 질문\",\"playbackMs\":0}"))
                .andExpect(status().isUnauthorized());
    }

    // ---- 입력 검증 ----

    @Test
    void blank_question_or_missing_position_is_400() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);

        assertFailure(ask(ids[0], instructor, "", 20_000), 400, "VALIDATION_FAILED");

        // 재생 위치가 없으면 어느 대목을 물었는지 알 수 없다 — 0으로 때려 넣지 않고 거절한다.
        write(post("/api/lessons/" + ids[0] + "/ai/answers/stream").accept(MediaType.TEXT_EVENT_STREAM),
                instructor, "{\"question\":\"위치 없는 질문\"}")
                .andExpect(status().isBadRequest());

        write(post("/api/lessons/" + ids[0] + "/ai/answers/stream").accept(MediaType.TEXT_EVENT_STREAM),
                instructor, "{\"question\":\"음수 위치\",\"playbackMs\":-1}")
                .andExpect(status().isBadRequest());

        assertThat(captured.get()).isNull();
    }

    // ---- 에러 매핑(스트림 시작 전) ----

    @Test
    void upstream_failures_map_to_the_same_codes_as_live() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);

        responder.set(exchange -> statusOnly(exchange, 503));
        assertFailure(ask(ids[0], instructor, "AI 준비됐어?", 20_000), 503, "AI_ANSWER_UNAVAILABLE");

        responder.set(exchange -> statusOnly(exchange, 409));
        assertFailure(ask(ids[0], instructor, "중복 요청", 20_000), 409, "AI_ANSWER_REQUEST_CONFLICT");

        // 401(서명 거부)은 우리 설정 문제다. 그대로 흘리면 FE가 세션 만료로 오해해 로그아웃한다.
        responder.set(exchange -> statusOnly(exchange, 401));
        assertFailure(ask(ids[0], instructor, "서명 틀린 요청", 20_000), 502, "AI_ANSWER_UPSTREAM_REJECTED");
    }

    // ---- 헬퍼 ----

    private static String header(HttpExchange exchange, String name) {
        String value = exchange.getRequestHeaders().getFirst(name);
        return value == null ? "" : value;
    }

    private static void sse(HttpExchange exchange, String... frames) throws IOException {
        exchange.getResponseHeaders().set("Content-Type", "text/event-stream");
        exchange.sendResponseHeaders(200, 0);
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


    private OffsetDateTime sessionStart(UUID sessionId) {
        return liveSessionRepository.findById(sessionId).orElseThrow().getStartedAt();
    }

    private void saveStarted(UUID sessionId, String lessonId, String sttSessionId, OffsetDateTime audioStartedAt) {
        LiveCaption row = new LiveCaption();
        row.setEventId("started-" + UUID.randomUUID());
        row.setEventType("caption.stream.started");
        row.setSessionId(sessionId);
        row.setLessonId(UUID.fromString(lessonId));
        row.setSttSessionId(sttSessionId);
        row.setAudioStartedAt(audioStartedAt);
        row.setOccurredAt(audioStartedAt);
        liveCaptionRepository.saveAndFlush(row);
    }

    /** 발화 벽시계 없이 저장한다 — 이 기능 이전에 녹화된 강의를 재현한다. */
    private void saveSegment(UUID sessionId, String lessonId, String sttSessionId,
                             long segmentIndex, long startElapsedMs, long endElapsedMs, String text) {
        saveSegment(sessionId, lessonId, sttSessionId, segmentIndex, startElapsedMs, endElapsedMs,
                text, null, null);
    }

    private void saveSegment(UUID sessionId, String lessonId, String sttSessionId,
                             long segmentIndex, long startElapsedMs, long endElapsedMs, String text,
                             OffsetDateTime startedAt, OffsetDateTime endedAt) {
        LiveCaption row = new LiveCaption();
        row.setStartedAt(startedAt);
        row.setEndedAt(endedAt);
        row.setEventId("segment-" + UUID.randomUUID());
        row.setEventType("caption.segment.final");
        row.setSessionId(sessionId);
        row.setLessonId(UUID.fromString(lessonId));
        row.setSttSessionId(sttSessionId);
        row.setSegmentIndex(segmentIndex);
        row.setStartStreamElapsedMs(startElapsedMs);
        row.setEndStreamElapsedMs(endElapsedMs);
        row.setText(text);
        row.setOccurredAt(OffsetDateTime.now());
        liveCaptionRepository.saveAndFlush(row);
    }

    /** 질의 응답. 실제 포트로 받으므로 {@code body}는 스트림이 끝난 뒤의 <b>완결된</b> 본문이다. */
    private record Answer(int status, String body) {
    }

    /**
     * 다시보기 AI 질의를 <b>우리 앱의 실제 포트</b>로 보낸다({@link #port}). ai-api는 목 그대로다.
     *
     * <p>세션 쿠키는 MockMvc 로그인에서 받은 것을 그대로 싣는다 — 세션 저장소가 Redis라 두 경로가
     * 같은 세션을 본다. CSRF는 이 경로에서 새로 받는다(쿠키와 헤더가 한 쌍이어야 한다).
     */
    private Answer ask(String lessonId, Cookie[] auth, String question, long playbackSessionMs)
            throws Exception {
        String body = jsonMapper.writeValueAsString(
                Map.of("question", question, "playbackMs", playbackSessionMs));

        HttpClient client = HttpClient.newHttpClient();
        HttpResponse<String> csrf = client.send(
                HttpRequest.newBuilder(URI.create(baseUrl() + "/api/auth/csrf")).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        JsonNode csrfBody = jsonMapper.readTree(csrf.body());

        StringBuilder cookies = new StringBuilder("XSRF-TOKEN=").append(cookieValue(csrf, "XSRF-TOKEN"));
        if (auth != null) {
            for (Cookie cookie : auth) {
                cookies.append("; ").append(cookie.getName()).append('=').append(cookie.getValue());
            }
        }

        HttpResponse<String> response = client.send(HttpRequest.newBuilder(
                        URI.create(baseUrl() + "/api/lessons/" + lessonId + "/ai/answers/stream"))
                .header("Cookie", cookies.toString())
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString())
                .header(HttpHeaders.ACCEPT, MediaType.TEXT_EVENT_STREAM_VALUE)
                .header(HttpHeaders.CONTENT_TYPE, MediaType.APPLICATION_JSON_VALUE)
                .POST(HttpRequest.BodyPublishers.ofString(body, StandardCharsets.UTF_8))
                .build(), HttpResponse.BodyHandlers.ofString(StandardCharsets.UTF_8));
        return new Answer(response.statusCode(), response.body());
    }

    private String baseUrl() {
        return "http://localhost:" + port;
    }

    /** Set-Cookie에서 값만 꺼낸다 — 실제 HTTP 응답은 MockMvc의 {@code Cookie} 객체를 주지 않는다. */
    private static String cookieValue(HttpResponse<?> response, String name) {
        return response.headers().allValues("set-cookie").stream()
                .filter(header -> header.startsWith(name + "="))
                .map(header -> header.substring(name.length() + 1).split(";", 2)[0])
                .findFirst()
                .orElseThrow(() -> new AssertionError(name + " 쿠키가 없다"));
    }

    /** 200을 확인하고 SSE 본문을 돌려준다. */
    private static String assertOk(Answer answer) {
        assertThat(answer.status()).as("본문: %s", answer.body()).isEqualTo(200);
        return answer.body();
    }

    /** 실패 응답의 상태와 {@code code}를 함께 본다 — 화면이 코드로 분기하므로 둘 다 계약이다. */
    private void assertFailure(Answer answer, int status, String code) {
        assertThat(answer.status()).as("본문: %s", answer.body()).isEqualTo(status);
        assertThat(jsonMapper.readTree(answer.body()).get("code").asString()).isEqualTo(code);
    }

    private void publish(Cookie[] instructor, String lessonId) throws Exception {
        write(post("/api/instructor/lessons/" + lessonId + "/replay-review/publish"), instructor, null)
                .andExpect(status().isNoContent());
    }

    /** 자동 게시된 자산을 DRAFT로 되돌린다 — "학생에게 아직 안 보이는" 상태를 만드는 유일한 방법. */
    private void unpublish(String sessionId) {
        var asset = videoAssetRepository.findByLiveSessionId(UUID.fromString(sessionId)).orElseThrow();
        asset.setReplayStatus(ReplayStatus.DRAFT);
        asset.setPublishedAt(null);
        asset.setPublishedBy(null);
        videoAssetRepository.saveAndFlush(asset);
    }

    /** [0]=lessonId, [1]=sessionId, [2]=curriculumId. 종료·녹화 확정까지 끝낸 다시보기. */
    private String[] createReadyRecording(Cookie[] instructor) throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        when(egressControl.startHlsRecording(any(), any())).thenReturn(egressId);
        when(egressControl.findState(any())).thenReturn(Optional.of(EgressControl.EgressState.EGRESS_ACTIVE));
        when(recordingStorage.head(any(), any())).thenReturn(Optional.of(1_024L));
        stubManifest(LIVE_MANIFEST);

        String[] base = createSession(instructor);
        String instructorId = json(mockMvc.perform(get("/api/auth/me").cookie(instructor)).andReturn())
                .get("userId").asString();
        LiveStartTestSupport.stubInstructorPublishing(roomControl, base[1], instructorId);
        LiveStartTestSupport.stubAgentDispatched(agentDispatchControl);
        write(post("/api/live-sessions/" + base[1] + "/start"), instructor, null)
                .andExpect(status().isAccepted());
        LiveStartTestSupport.awaitLive(liveSessionRepository, base[1]);
        stubManifest(MANIFEST);

        write(post("/api/live-sessions/" + base[1] + "/end"), instructor, null).andExpect(status().isOk());
        completeRecording(egressId);
        return base;
    }

    private void stubManifest(String manifest) {
        when(recordingStorage.findManifest(anyString(), anyString())).thenReturn(Optional.of(manifest));
        when(recordingStorage.presignSegment(anyString(), anyString(), any(Duration.class)))
                .thenAnswer(invocation -> "https://minio.local/" + invocation.getArgument(1));
    }

    private void completeRecording(String egressId) throws Exception {
        when(recordingStorage.head(any(), any())).thenReturn(Optional.of(10_485_760L));
        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE",
                "segmentResults":[{"playlistName":"index.m3u8","duration":"600000000000","size":"10485760","segmentCount":300}]}}
                """.formatted(egressId);
        mockMvc.perform(post("/api/webhooks/livekit")
                        .contentType(MediaType.APPLICATION_JSON)
                        .header(HttpHeaders.AUTHORIZATION, sign(body))
                        .content(body))
                .andExpect(status().isNoContent());
    }

    private String sign(String body) {
        return JWT.create().withClaim("sha256", sha256Base64(body))
                .sign(Algorithm.HMAC256(livekit.apiSecret()));
    }

    private String sha256Base64(String body) {
        try {
            return Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256")
                    .digest(body.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** [0]=lessonId, [1]=sessionId, [2]=curriculumId. */
    private String[] createSession(Cookie[] instructor) throws Exception {
        String curriculumId = json(write(post("/api/instructor/curriculums"), instructor,
                "{\"title\":\"다시보기 AI\"}").andReturn()).get("curriculumId").asString();
        String sectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"),
                instructor, "{\"title\":\"s\"}").andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sectionId + "/lessons"),
                instructor, "{\"title\":\"l\"}").andReturn()).get("lessonId").asString();
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"),
                instructor, null).andReturn()).get("sessionId").asString();
        createdSessions.add(UUID.fromString(sessionId));
        return new String[]{lessonId, sessionId, curriculumId};
    }

    private void approveEnrollment(Cookie[] instructor, Cookie[] student, String curriculumId) throws Exception {
        // 게시 선행 조건(ADR-0006): 섹션·강의가 각각 1개 이상 있어야 발행된다.
        String seedSectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"),
                instructor, "{\"title\":\"게시용 섹션\"}").andExpect(status().isCreated()).andReturn())
                .get("sectionId").asString();
        write(post("/api/instructor/sections/" + seedSectionId + "/lessons"), instructor,
                "{\"title\":\"게시용 강의\"}").andExpect(status().isCreated());
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), instructor, null)
                .andExpect(status().isOk());
        String enrollmentId = json(write(post("/api/curriculums/" + curriculumId + "/enrollments"), student, null)
                .andExpect(status().isCreated()).andReturn()).get("enrollmentId").asString();
        write(post("/api/instructor/curriculums/" + curriculumId + "/enrollments/" + enrollmentId + "/approve"),
                instructor, null).andExpect(status().isOk());
    }

    private ResultActions write(MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body)
            throws Exception {
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
        String email = "replay-ai-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        return write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn().getResponse().getCookies();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
