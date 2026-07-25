package com.liveclass.video;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.liveclass.live.api.LiveKitServerAccess;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.service.EgressControl;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
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
 * LiveKit egress webhook 계약 (liveclass-103, ADR-0034).
 *
 * <p>실커밋 흐름이다(비-@Transactional) — 자산은 RecordingService(REQUIRES_NEW)가 별도 tx로 커밋해야
 * webhook 컨트롤러가 본다. 만든 video_asset은 @AfterEach로 정리한다.
 *
 * <p>검증 포인트: 완료→READY+메타, 실패→FAILED, 서명 위조·누락→401, 멱등, 모르는 egress 무시.
 */
@SpringBootTest
@AutoConfigureMockMvc
class LiveKitWebhookContractTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private VideoAssetRepository videoAssetRepository;
    @Autowired private LiveKitServerAccess livekit;

    @MockitoBean private EgressControl egressControl;      // 실 LiveKit 안 타게 목.
    @MockitoBean private LiveRoomControl roomControl;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private final List<UUID> createdSessions = new ArrayList<>();

    @AfterEach
    void cleanup() {
        for (UUID sessionId : createdSessions) {
            videoAssetRepository.findByLiveSessionId(sessionId).ifPresent(videoAssetRepository::delete);
        }
        createdSessions.clear();
    }

    @Test
    void egress_complete_webhook_sets_asset_ready_with_metadata() throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        String sessionId = startRecording(egressId);

        // 600초·10MiB·300세그먼트 완료 (duration은 나노초).
        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE",
                "segmentResults":[{"playlistName":"index.m3u8","duration":"600000000000","size":"10485760","segmentCount":300}]}}
                """.formatted(egressId);
        postWebhook(body, sign(body)).andExpect(status().isNoContent());

        var asset = videoAssetRepository.findByLiveSessionId(UUID.fromString(sessionId)).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.READY);
        assertThat(asset.getDurationMs()).isEqualTo(600_000L);   // 600e9 ns → 600e3 ms
        assertThat(asset.getSizeBytes()).isEqualTo(10_485_760L);
        assertThat(asset.getSegmentCount()).isEqualTo(300);
        assertThat(asset.getReadyAt()).isNotNull();
    }

    @Test
    void egress_failed_webhook_sets_asset_failed() throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        String sessionId = startRecording(egressId);

        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_FAILED","error":"disk full"}}
                """.formatted(egressId);
        postWebhook(body, sign(body)).andExpect(status().isNoContent());

        var asset = videoAssetRepository.findByLiveSessionId(UUID.fromString(sessionId)).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.FAILED);
        assertThat(asset.getFailureCode()).contains("disk full");
    }

    @Test
    void invalid_signature_is_rejected_401() throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        String sessionId = startRecording(egressId);

        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE"}}
                """.formatted(egressId);
        // 엉뚱한 secret으로 서명 → 401.
        String badJwt = JWT.create().withClaim("sha256", sha256Base64(body))
                .sign(Algorithm.HMAC256("wrong-secret"));
        postWebhook(body, badJwt).andExpect(status().isUnauthorized());

        // 자산은 그대로 FINALIZING(안 바뀜).
        var asset = videoAssetRepository.findByLiveSessionId(UUID.fromString(sessionId)).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.FINALIZING);
    }

    @Test
    void missing_signature_is_rejected_401() throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        startRecording(egressId);
        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE"}}
                """.formatted(egressId);
        mockMvc.perform(post("/api/webhooks/livekit")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void tampered_body_is_rejected_401() throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        startRecording(egressId);
        String signedBody = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE"}}
                """.formatted(egressId);
        String jwt = sign(signedBody);
        // 서명은 원본 기준인데 본문을 바꿔 보낸다 → 해시 불일치 401.
        String tampered = signedBody.replace("EGRESS_COMPLETE", "EGRESS_FAILED");
        postWebhook(tampered, jwt).andExpect(status().isUnauthorized());
    }

    @Test
    void duplicate_complete_is_idempotent() throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        String sessionId = startRecording(egressId);
        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE",
                "segmentResults":[{"playlistName":"index.m3u8","duration":"600000000000","size":"10485760","segmentCount":300}]}}
                """.formatted(egressId);
        postWebhook(body, sign(body)).andExpect(status().isNoContent());
        // 같은 완료가 또 와도 안전(멱등).
        postWebhook(body, sign(body)).andExpect(status().isNoContent());

        var asset = videoAssetRepository.findByLiveSessionId(UUID.fromString(sessionId)).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.READY);
    }

    @Test
    void unknown_egress_is_ignored() throws Exception {
        // 우리 자산이 아닌 egressId — 조용히 무시(204), 잘못된 실패 표시를 만들지 않는다.
        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"EG_%s","status":"EGRESS_FAILED"}}
                """.formatted(UUID.randomUUID());
        postWebhook(body, sign(body)).andExpect(status().isNoContent());
    }

    @Test
    void non_egress_ended_event_is_ignored() throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        String sessionId = startRecording(egressId);
        // 진행 이벤트는 무시 — 자산 상태 안 바뀜.
        String body = """
                {"event":"egress_updated","egressInfo":{"egressId":"%s","status":"EGRESS_ACTIVE"}}
                """.formatted(egressId);
        postWebhook(body, sign(body)).andExpect(status().isNoContent());

        var asset = videoAssetRepository.findByLiveSessionId(UUID.fromString(sessionId)).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.FINALIZING);
    }

    // ---- 헬퍼 ----

    /** 세션을 만들고 라이브 시작→종료해 자산을 egressId·FINALIZING 상태로 커밋한다. */
    private String startRecording(String egressId) throws Exception {
        when(egressControl.startHlsRecording(any(), any())).thenReturn(egressId);
        Cookie[] instructor = loginAs();
        String[] ids = createSession(instructor);
        String sessionId = ids[1];
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isOk());
        write(post("/api/live-sessions/" + sessionId + "/end"), instructor, null).andExpect(status().isOk());
        return sessionId;
    }

    private org.springframework.test.web.servlet.ResultActions postWebhook(String body, String jwt) throws Exception {
        return mockMvc.perform(post("/api/webhooks/livekit")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", jwt)
                .content(body));
    }

    /** LiveKit이 보내는 것과 같은 방식으로 서명: apiSecret HS256 + 본문 sha256 클레임. */
    private String sign(String body) {
        return JWT.create().withClaim("sha256", sha256Base64(body)).sign(Algorithm.HMAC256(livekit.apiSecret()));
    }

    private String sha256Base64(String body) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256").digest(body.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    private String[] createSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"녹화\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"s\"}")
                .andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"l\"}")
                .andReturn()).get("lessonId").asString();
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null)
                .andReturn()).get("sessionId").asString();
        createdSessions.add(UUID.fromString(sessionId));
        return new String[]{lessonId, sessionId};
    }

    private org.springframework.test.web.servlet.ResultActions write(
            MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body) throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = json(csrf);
        Cookie xsrf = csrf.getResponse().getCookie("XSRF-TOKEN");
        List<Cookie> cookies = new ArrayList<>();
        cookies.add(xsrf);
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
        String email = "wh-" + UUID.randomUUID() + "@liveclass.test";
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
