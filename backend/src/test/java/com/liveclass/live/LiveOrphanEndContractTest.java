package com.liveclass.live;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.liveclass.live.api.LiveKitServerAccess;
import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.repository.LiveSessionRepository;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.LiveEndOrchestrator;
import com.liveclass.live.service.LiveEndReconciler;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.support.LiveStartTestSupport;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 강사가 종료를 누르지 않고 사라진 라이브가 끝나는가(ADR-0119).
 *
 * <p>두 경로를 각각 본다 — LiveKit이 방을 닫아 주는 경우({@code room_finished} webhook)와,
 * 학생이 남아 방이 안 닫히는 경우(재조정 루프).
 *
 * <p>유예를 0으로 낮춰 둔다. 실제 값(2분·12분)을 그대로 쓰면 테스트가 그만큼 자야 하고, 여기서
 * 확인하려는 것은 "유예가 몇 분이냐"가 아니라 <b>유예가 지나면 끝나고 안 지나면 안 끝난다</b>는
 * 규칙이기 때문이다. 유예를 지키는지는 큰 값을 준 재조정기를 직접 만들어 따로 본다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@TestPropertySource(properties = {
        "live.end.start-grace=0s",
        "live.end.empty-grace=0s",
        // 유예의 하한은 방 이탈 유예다. 0으로 낮추려면 그쪽도 같이 내려야 한다 —
        // 이 결합 자체를 empty_grace_is_floored_by_the_room_departure_timeout이 따로 본다.
        "livekit.room-departure-timeout-seconds=0",
        // 스케줄이 스스로 돌면 어느 호출이 무엇을 바꿨는지 알 수 없다. 테스트가 직접 부른다.
        "live.end.reconcile-initial-delay=999999s"
})
class LiveOrphanEndContractTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private LiveSessionRepository liveSessionRepository;
    @Autowired private LiveKitServerAccess livekit;
    @Autowired private LiveEndReconciler endReconciler;

    @MockitoBean private LiveRoomControl roomControl;
    @MockitoBean private AgentDispatchControl agentDispatchControl;
    @MockitoBean private LiveRecordingControl recordingControl;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void room_finished_ends_a_session_the_instructor_left_without_ending() throws Exception {
        String sessionId = startLive();

        postRoomFinished("session-" + sessionId).andExpect(status().isNoContent());

        assertThat(statusOf(sessionId)).isEqualTo(LiveSessionStatus.ENDED);
        assertThat(liveSessionRepository.findById(UUID.fromString(sessionId)).orElseThrow().getEndedAt())
                .isNotNull();
    }

    @Test
    void room_finished_for_an_unknown_room_changes_nothing() throws Exception {
        String sessionId = startLive();

        // 같은 LiveKit을 다른 용도로 쓰면 우리 규칙이 아닌 방이 닫힌다. 오류가 아니라 남의 일이다.
        postRoomFinished("stt-bot-scratch").andExpect(status().isNoContent());
        // 우리 규칙처럼 생겼지만 UUID가 아닌 경우도 마찬가지.
        postRoomFinished("session-not-a-uuid").andExpect(status().isNoContent());

        assertThat(statusOf(sessionId)).isEqualTo(LiveSessionStatus.LIVE);
    }

    @Test
    void room_finished_twice_is_safe() throws Exception {
        String sessionId = startLive();

        postRoomFinished("session-" + sessionId).andExpect(status().isNoContent());
        var endedAt = liveSessionRepository.findById(UUID.fromString(sessionId)).orElseThrow().getEndedAt();
        // 재배달돼도 종료 시각이 밀리면 안 된다 — 다시보기 앵커가 그 값에 걸려 있다.
        postRoomFinished("session-" + sessionId).andExpect(status().isNoContent());

        assertThat(statusOf(sessionId)).isEqualTo(LiveSessionStatus.ENDED);
        assertThat(liveSessionRepository.findById(UUID.fromString(sessionId)).orElseThrow().getEndedAt())
                .isEqualTo(endedAt);
    }

    @Test
    void reconciler_ends_a_session_whose_room_went_empty() throws Exception {
        String sessionId = startLive();
        // 강사도 학생도 없다. 방이 없어도 LiveRoomControl은 빈 목록을 준다 — 우리에겐 같은 뜻이다.
        when(roomControl.listParticipants(any())).thenReturn(List.of());

        // 첫 주기는 "비었다"를 관찰만 한다. 한 번 봤다고 끊지 않는다.
        endReconciler.reconcile();
        assertThat(statusOf(sessionId)).isEqualTo(LiveSessionStatus.LIVE);

        endReconciler.reconcile();
        assertThat(statusOf(sessionId)).isEqualTo(LiveSessionStatus.ENDED);
    }

    @Test
    void reconciler_leaves_a_room_that_still_has_people() throws Exception {
        String sessionId = startLive();
        // 강사만 창을 닫고 학생이 남은 상황 — 방이 안 닫혀 webhook은 오지 않는다. 그래도 끝내면 안 된다.
        when(roomControl.listParticipants(any())).thenReturn(List.of(
                new LiveRoomControl.RoomParticipant("student-1", "학생", "ACTIVE", 0L)));

        endReconciler.reconcile();
        endReconciler.reconcile();

        assertThat(statusOf(sessionId)).isEqualTo(LiveSessionStatus.LIVE);
    }

    @Test
    void reconciler_does_not_end_a_session_before_the_grace_elapses() throws Exception {
        String sessionId = startLive();
        when(roomControl.listParticipants(any())).thenReturn(List.of());

        // 유예를 넉넉히 준 재조정기. 방이 비었어도 그 시간이 지나기 전에는 손대지 않는다.
        LiveEndReconciler patient = new LiveEndReconciler(liveSessionRepository, roomControl,
                endOrchestrator, Duration.ZERO, Duration.ofHours(1), 0);
        patient.reconcile();
        patient.reconcile();

        assertThat(statusOf(sessionId)).isEqualTo(LiveSessionStatus.LIVE);
    }

    /**
     * 방 이탈 유예(livekit.room-departure-timeout-seconds)보다 짧게 끊지 않는다.
     *
     * <p>그 시간은 <b>끊긴 강사가 돌아오기를 기다리는</b> 시간이고, 그동안 방은 비어 있다.
     * 여기서 먼저 세션을 끝내면 방을 열어 둔 의미가 없어진다 — 설정이 짧게 잡혀 있어도
     * 재조정기가 하한을 지켜야 한다.
     */
    @Test
    void empty_grace_is_floored_by_the_room_departure_timeout() throws Exception {
        String sessionId = startLive();
        when(roomControl.listParticipants(any())).thenReturn(List.of());

        // 설정은 1초지만 방은 10분간 강사를 기다린다 → 1초로 끊으면 안 된다.
        LiveEndReconciler misconfigured = new LiveEndReconciler(liveSessionRepository, roomControl,
                endOrchestrator, Duration.ZERO, Duration.ofSeconds(1), 600);
        misconfigured.reconcile();
        misconfigured.reconcile();

        assertThat(statusOf(sessionId)).isEqualTo(LiveSessionStatus.LIVE);
    }

    // ---- 헬퍼 ----

    @Autowired private LiveEndOrchestrator endOrchestrator;

    private LiveSessionStatus statusOf(String sessionId) {
        return liveSessionRepository.findById(UUID.fromString(sessionId)).orElseThrow().getStatus();
    }

    /** 세션을 만들고 실제로 LIVE까지 올린다(시작 게이트를 흉내낸 스텁 위에서). */
    private String startLive() throws Exception {
        Cookie[] instructor = loginAs();
        String sessionId = createSession(instructor);
        String instructorId = json(mockMvc.perform(get("/api/auth/me").cookie(instructor)).andReturn())
                .get("userId").asString();
        LiveStartTestSupport.stubInstructorPublishing(roomControl, sessionId, instructorId);
        LiveStartTestSupport.stubAgentDispatched(agentDispatchControl);
        LiveStartTestSupport.stubRecordingReady(recordingControl);
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null)
                .andExpect(status().isAccepted());
        LiveStartTestSupport.awaitLive(liveSessionRepository, sessionId);
        return sessionId;
    }

    private ResultActions postRoomFinished(String roomName) throws Exception {
        String body = """
                {"event":"room_finished","room":{"sid":"RM_test","name":"%s"}}
                """.formatted(roomName);
        return mockMvc.perform(post("/api/webhooks/livekit")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", sign(body))
                .content(body));
    }

    /** LiveKit이 보내는 것과 같은 방식으로 서명: apiSecret HS256 + 본문 sha256 클레임. */
    private String sign(String body) {
        return JWT.create().withClaim("sha256", sha256Base64(body))
                .sign(Algorithm.HMAC256(livekit.apiSecret()));
    }

    private String sha256Base64(String body) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private String createSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"고아 종료\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"s\"}")
                .andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"l\"}")
                .andReturn()).get("lessonId").asString();
        return json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null)
                .andReturn()).get("sessionId").asString();
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

    private Cookie[] loginAs() throws Exception {
        String email = "orphan-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"INSTRUCTOR"}
                """.formatted(email)).andExpect(status().isCreated());
        return write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn().getResponse().getCookies();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
