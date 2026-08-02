package com.liveclass.video;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.liveclass.live.api.LiveKitServerAccess;
import com.liveclass.live.repository.LiveSessionRepository;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.support.LiveStartTestSupport;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.domain.ReplayStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.service.EgressControl;
import com.liveclass.video.service.S3RecordingStorage;
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
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
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
    @Autowired private LiveSessionRepository liveSessionRepository;

    @MockitoBean private EgressControl egressControl;      // 실 LiveKit 안 타게 목.
    @MockitoBean private LiveRoomControl roomControl;
    @MockitoBean private AgentDispatchControl agentDispatchControl;
    // S3RecordingStorage가 RecordingStorage(VERIFYING HEAD)·ReplayStorage(재생) 둘 다 구현 —
    // 콘크리트 타입으로 모킹해야 같은 컨텍스트의 ReplayPlaybackService 주입점도 이 목으로 채워진다.
    @MockitoBean private S3RecordingStorage recordingStorage;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private final List<UUID> createdSessions = new ArrayList<>();
    private final Map<String, Cookie[]> ownersBySession = new HashMap<>();

    @AfterEach
    void cleanup() {
        for (UUID sessionId : createdSessions) {
            videoAssetRepository.findByLiveSessionId(sessionId).ifPresent(videoAssetRepository::delete);
        }
        createdSessions.clear();
        ownersBySession.clear();
    }

    @Test
    void egress_complete_webhook_sets_asset_ready_with_metadata() throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        String sessionId = startRecording(egressId);
        when(recordingStorage.head(any(), any())).thenReturn(Optional.of(10_485_760L));   // 매니페스트 존재.

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
        assertThat(asset.getReplayStatus()).isEqualTo(ReplayStatus.PUBLISHED);
        assertThat(asset.getPublishedAt()).isEqualTo(asset.getReadyAt());
        assertThat(asset.getPublishedBy()).isNull();
        assertThat(asset.getFailureCode()).isNull();
        mockMvc.perform(get("/api/instructor/live-sessions/" + sessionId + "/processing")
                        .cookie(ownersBySession.get(sessionId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.videoAsset.status").value("READY"))
                .andExpect(jsonPath("$.replayStatus").value("PUBLISHED"));
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
        assertThat(asset.getReplayStatus()).isEqualTo(ReplayStatus.DRAFT);
        assertThat(asset.getPublishedAt()).isNull();
        mockMvc.perform(get("/api/instructor/live-sessions/" + sessionId + "/processing")
                        .cookie(ownersBySession.get(sessionId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.videoAsset.status").value("FAILED"))
                .andExpect(jsonPath("$.videoAsset.failureCode").value(org.hamcrest.Matchers.containsString("disk full")))
                .andExpect(jsonPath("$.replayStatus").value("DRAFT"));
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
        when(recordingStorage.head(any(), any())).thenReturn(Optional.of(10_485_760L));
        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE",
                "segmentResults":[{"playlistName":"index.m3u8","duration":"600000000000","size":"10485760","segmentCount":300}]}}
                """.formatted(egressId);
        postWebhook(body, sign(body)).andExpect(status().isNoContent());
        var first = videoAssetRepository.findByLiveSessionId(UUID.fromString(sessionId)).orElseThrow();
        var firstReadyAt = first.getReadyAt();
        var firstPublishedAt = first.getPublishedAt();
        // 같은 완료가 또 와도 안전(멱등).
        postWebhook(body, sign(body)).andExpect(status().isNoContent());

        var asset = videoAssetRepository.findByLiveSessionId(UUID.fromString(sessionId)).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.READY);
        assertThat(asset.getReplayStatus()).isEqualTo(ReplayStatus.PUBLISHED);
        assertThat(asset.getReadyAt()).isEqualTo(firstReadyAt);
        assertThat(asset.getPublishedAt()).isEqualTo(firstPublishedAt);
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

    @Test
    void complete_but_manifest_missing_sets_failed() throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        String sessionId = startRecording(egressId);
        // COMPLETE라고 오지만 스토리지엔 매니페스트가 없다(부재 확정) → FAILED(MANIFEST_MISSING).
        when(recordingStorage.head(any(), any())).thenReturn(Optional.empty());

        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE",
                "segmentResults":[{"playlistName":"index.m3u8","duration":"600000000000","size":"10485760","segmentCount":300}]}}
                """.formatted(egressId);
        postWebhook(body, sign(body)).andExpect(status().isNoContent());

        var asset = videoAssetRepository.findByLiveSessionId(UUID.fromString(sessionId)).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.FAILED);
        assertThat(asset.getFailureCode()).isEqualTo("MANIFEST_MISSING");
        assertThat(asset.getReplayStatus()).isEqualTo(ReplayStatus.DRAFT);
        assertThat(asset.getPublishedAt()).isNull();
    }

    @Test
    void complete_with_verify_error_fails_open_to_ready() throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        String sessionId = startRecording(egressId);
        // 확인 자체가 실패(네트워크·설정 등) → 검증기가 실패원인이 되지 않게 COMPLETE 신뢰(fail-open) → READY.
        when(recordingStorage.head(any(), any())).thenThrow(new RuntimeException("connection refused"));

        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE",
                "segmentResults":[{"playlistName":"index.m3u8","duration":"600000000000","size":"10485760","segmentCount":300}]}}
                """.formatted(egressId);
        postWebhook(body, sign(body)).andExpect(status().isNoContent());

        var asset = videoAssetRepository.findByLiveSessionId(UUID.fromString(sessionId)).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.READY);
        assertThat(asset.getDurationMs()).isEqualTo(600_000L);
        assertThat(asset.getReplayStatus()).isEqualTo(ReplayStatus.PUBLISHED);
        assertThat(asset.getPublishedAt()).isEqualTo(asset.getReadyAt());
    }

    @Test
    void withdrawn_asset_is_not_republished_by_late_complete_webhook() throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        String sessionId = startRecording(egressId);
        var before = videoAssetRepository.findByLiveSessionId(UUID.fromString(sessionId)).orElseThrow();
        before.setReplayStatus(ReplayStatus.WITHDRAWN);
        before.setWithdrawReason("강사 철회");
        videoAssetRepository.saveAndFlush(before);
        when(recordingStorage.head(any(), any())).thenReturn(Optional.of(10_485_760L));

        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE"}}
                """.formatted(egressId);
        postWebhook(body, sign(body)).andExpect(status().isNoContent());

        var asset = videoAssetRepository.findByLiveSessionId(UUID.fromString(sessionId)).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(VideoAssetStatus.READY);
        assertThat(asset.getReplayStatus()).isEqualTo(ReplayStatus.WITHDRAWN);
        assertThat(asset.getPublishedAt()).isNull();
        assertThat(asset.getWithdrawReason()).isEqualTo("강사 철회");
    }

    // ---- 헬퍼 ----

    /** 세션을 만들고 라이브 시작→종료해 자산을 egressId·FINALIZING 상태로 커밋한다. */
    private String startRecording(String egressId) throws Exception {
        when(egressControl.startHlsRecording(any(), any())).thenReturn(egressId);
        // 시작 게이트(ADR-0002 §4)가 통과하도록 Egress ACTIVE + 라이브 매니페스트·첫 세그먼트를 흉내낸다.
        when(egressControl.findState(any())).thenReturn(Optional.of(EgressControl.EgressState.EGRESS_ACTIVE));
        when(recordingStorage.findManifest(any(), any())).thenReturn(Optional.of(LIVE_MANIFEST));
        when(recordingStorage.head(any(), any())).thenReturn(Optional.of(1_024L));
        Cookie[] instructor = loginAs();
        String[] ids = createSession(instructor);
        String sessionId = ids[1];
        ownersBySession.put(sessionId, instructor);
        String instructorId = json(mockMvc.perform(get("/api/auth/me").cookie(instructor)).andReturn())
                .get("userId").asString();
        LiveStartTestSupport.stubInstructorPublishing(roomControl, sessionId, instructorId);
        LiveStartTestSupport.stubAgentDispatched(agentDispatchControl);
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isAccepted());
        // 실커밋 테스트라 AFTER_COMMIT @Async 게이트가 실제로 돈다 — 끝날 때까지 기다린다.
        LiveStartTestSupport.awaitLive(liveSessionRepository, sessionId);
        write(post("/api/live-sessions/" + sessionId + "/end"), instructor, null).andExpect(status().isOk());
        return sessionId;
    }

    /** Gate C가 볼 라이브 재생목록(ENDLIST 없음 + 세그먼트 존재). */
    private static final String LIVE_MANIFEST = """
            #EXTM3U
            #EXT-X-VERSION:3
            #EXT-X-TARGETDURATION:2
            #EXT-X-MEDIA-SEQUENCE:0
            #EXTINF:2.0,
            seg_00000.ts
            """;

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
