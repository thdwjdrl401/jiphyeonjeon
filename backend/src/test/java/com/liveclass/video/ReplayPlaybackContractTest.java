package com.liveclass.video;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.liveclass.live.api.LiveKitServerAccess;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.service.EgressControl;
import com.liveclass.video.service.S3RecordingStorage;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 라이브 recent/dvr와 종료 후 다시보기 재생·게시 계약(choinhoo/0001).
 * 실제 커밋 흐름으로 세션·수강·녹화 상태를 만들고 HTTP 필드·상태코드를 검증한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ReplayPlaybackContractTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private VideoAssetRepository videoAssetRepository;
    @Autowired private LiveKitServerAccess livekit;

    @MockitoBean private EgressControl egressControl;
    @MockitoBean private LiveRoomControl roomControl;
    @MockitoBean private S3RecordingStorage recordingStorage;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private final List<UUID> createdSessions = new ArrayList<>();

    private static final String MANIFEST = """
            #EXTM3U
            #EXT-X-VERSION:3
            #EXT-X-TARGETDURATION:2
            #EXT-X-PLAYLIST-TYPE:VOD
            #EXT-X-PROGRAM-DATE-TIME:2026-07-26T10:00:00.000Z
            #EXTINF:2.0,
            seg_00000.ts
            #EXTINF:2.0,
            seg_00001.ts
            #EXT-X-ENDLIST
            """;

    private static final String FMP4_MANIFEST = """
            #EXTM3U
            #EXT-X-VERSION:7
            #EXT-X-TARGETDURATION:2
            #EXT-X-PROGRAM-DATE-TIME:2026-07-26T10:00:00.000Z
            #EXT-X-MAP:URI="./init.mp4"
            #EXT-X-KEY:METHOD=AES-128,URI="./key.bin"
            #EXTINF:2.0,
            ./seg_00000.m4s
            #EXTINF:2.0,
            seg_00001.m4s
            #EXT-X-ENDLIST
            """;

    @AfterEach
    void cleanup() {
        for (UUID sessionId : createdSessions) {
            videoAssetRepository.findByLiveSessionId(sessionId).ifPresent(videoAssetRepository::delete);
        }
        createdSessions.clear();
    }

    @Test
    void owner_can_preview_ready_draft_replay_metadata() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor, MANIFEST);

        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lessonId").value(ids[0]))
                .andExpect(jsonPath("$.videoAssetId").isString())
                .andExpect(jsonPath("$.sessionId").value(ids[1]))
                .andExpect(jsonPath("$.liveSessionStatus").value("ENDED"))
                .andExpect(jsonPath("$.currentSessionMs").isNumber())
                .andExpect(jsonPath("$.sessionOffsetMs").isNumber())
                .andExpect(jsonPath("$.durationMs").value(600_000))
                .andExpect(jsonPath("$.sources.recent").doesNotExist())
                .andExpect(jsonPath("$.sources.dvr.url")
                        .value("/api/lessons/" + ids[0] + "/playback/manifest?source=dvr"))
                .andExpect(jsonPath("$.sources.dvr.availableFromMs").isNumber())
                .andExpect(jsonPath("$.sources.dvr.availableToMs").isNumber());
    }

    @Test
    void active_enrolled_student_can_play_draft_live_recent_and_dvr() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        Cookie[] student = loginAs("STUDENT");
        String[] ids = createActiveRecording(instructor, MANIFEST);
        publishLesson(instructor, ids[0]);
        approveEnrollment(instructor, student, ids[2]);

        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback").cookie(student))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSessionStatus").value("LIVE"))
                .andExpect(jsonPath("$.durationMs").doesNotExist())
                .andExpect(jsonPath("$.sources.recent.url")
                        .value("/api/lessons/" + ids[0] + "/playback/manifest?source=recent"))
                .andExpect(jsonPath("$.sources.dvr.url")
                        .value("/api/lessons/" + ids[0] + "/playback/manifest?source=dvr"));
    }

    @Test
    void active_manifest_delay_is_null_metadata_and_409_for_direct_manifest() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createActiveRecording(instructor, null);

        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sources.recent").doesNotExist())
                .andExpect(jsonPath("$.sources.dvr").doesNotExist());

        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback/manifest")
                        .param("source", "recent").cookie(instructor))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RECORDING_STARTING"));
    }

    @Test
    void hls_manifest_has_media_type_no_store_and_rewritten_uris() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor, FMP4_MANIFEST);

        MvcResult result = mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback/manifest")
                        .param("source", "dvr").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(content().contentType("application/vnd.apple.mpegurl"))
                .andExpect(header().string(HttpHeaders.CACHE_CONTROL, "no-store"))
                .andReturn();

        String manifest = result.getResponse().getContentAsString();
        assertThat(manifest)
                .contains("seg_00000.m4s?")
                .contains("seg_00001.m4s?")
                .contains("init.mp4?")
                .contains("key.bin?")
                .doesNotContain("./seg_00000.m4s")
                .doesNotContain("URI=\"./init.mp4\"")
                .doesNotContain("URI=\"./key.bin\"");
    }

    @Test
    void unsafe_parent_path_in_manifest_is_rejected() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String unsafe = "#EXTM3U\n#EXTINF:2.0,\n../other-session/secret.ts\n#EXT-X-ENDLIST\n";
        String[] ids = createReadyRecording(instructor, unsafe);

        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback/manifest")
                        .param("source", "dvr").cookie(instructor))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REPLAY_NOT_READY"));
    }

    @Test
    void invalid_source_is_400() throws Exception {
        Cookie[] user = loginAs("INSTRUCTOR");
        mockMvc.perform(get("/api/lessons/" + UUID.randomUUID() + "/playback/manifest")
                        .param("source", "unknown").cookie(user))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("PLAYBACK_SOURCE_INVALID"));
    }

    @Test
    void enrolled_student_can_play_published_replay() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        Cookie[] student = loginAs("STUDENT");
        String[] ids = createReadyRecording(instructor, MANIFEST);
        publishLesson(instructor, ids[0]);
        approveEnrollment(instructor, student, ids[2]);
        write(post("/api/instructor/lessons/" + ids[0] + "/replay-review/publish"), instructor, null)
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback").cookie(student))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sources.dvr").exists());
    }

    @Test
    void ended_draft_replay_is_hidden_from_student() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        Cookie[] student = loginAs("STUDENT");
        String[] ids = createReadyRecording(instructor, MANIFEST);
        publishLesson(instructor, ids[0]);
        approveEnrollment(instructor, student, ids[2]);

        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback").cookie(student))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("REPLAY_NOT_FOUND"));
    }

    @Test
    void unpublished_lesson_is_hidden_from_enrolled_student() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        Cookie[] student = loginAs("STUDENT");
        String[] ids = createActiveRecording(instructor, MANIFEST);
        approveEnrollment(instructor, student, ids[2]);

        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback").cookie(student))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LESSON_NOT_FOUND"));
    }

    @Test
    void unenrolled_student_gets_403_enrollment_required() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        Cookie[] outsider = loginAs("STUDENT");
        String[] ids = createActiveRecording(instructor, MANIFEST);
        publishLesson(instructor, ids[0]);

        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback").cookie(outsider))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_REQUIRED"));
    }

    @Test
    void ended_ready_asset_with_missing_manifest_is_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor, MANIFEST);
        when(recordingStorage.findManifest(anyString(), anyString())).thenReturn(Optional.empty());

        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback").cookie(instructor))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REPLAY_NOT_READY"));
    }

    @Test
    void storage_failure_is_503() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor, MANIFEST);
        when(recordingStorage.findManifest(anyString(), anyString()))
                .thenThrow(new RuntimeException("connection refused"));

        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback").cookie(instructor))
                .andExpect(status().isServiceUnavailable())
                .andExpect(jsonPath("$.code").value("PLAYBACK_STORAGE_UNAVAILABLE"));
    }

    @Test
    void publish_requires_owner_and_ready_and_is_idempotent() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        Cookie[] other = loginAs("INSTRUCTOR");
        String[] active = createActiveRecording(instructor, MANIFEST);

        write(post("/api/instructor/lessons/" + active[0] + "/replay-review/publish"), other, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("REPLAY_FORBIDDEN"));
        write(post("/api/instructor/lessons/" + active[0] + "/replay-review/publish"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REPLAY_PUBLISH_CONFLICT"));

        write(post("/api/live-sessions/" + active[1] + "/end"), instructor, null)
                .andExpect(status().isOk());
        completeRecording(active[3]);
        write(post("/api/instructor/lessons/" + active[0] + "/replay-review/publish"), instructor, null)
                .andExpect(status().isNoContent());
        write(post("/api/instructor/lessons/" + active[0] + "/replay-review/publish"), instructor, null)
                .andExpect(status().isNoContent());
    }

    @Test
    void withdraw_is_blocked_while_live_then_hides_and_can_republish() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        Cookie[] student = loginAs("STUDENT");
        String[] ids = createActiveRecording(instructor, MANIFEST);
        publishLesson(instructor, ids[0]);
        approveEnrollment(instructor, student, ids[2]);

        write(post("/api/instructor/lessons/" + ids[0] + "/replay-review/withdraw"),
                instructor, "{\"reason\":\"교정 필요\"}")
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REPLAY_WITHDRAW_WHILE_LIVE"));

        write(post("/api/live-sessions/" + ids[1] + "/end"), instructor, null)
                .andExpect(status().isOk());
        completeRecording(ids[3]);
        write(post("/api/instructor/lessons/" + ids[0] + "/replay-review/publish"), instructor, null)
                .andExpect(status().isNoContent());
        write(post("/api/instructor/lessons/" + ids[0] + "/replay-review/withdraw"),
                instructor, "{\"reason\":\"교정 필요\"}")
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback").cookie(student))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("REPLAY_NOT_FOUND"));

        write(post("/api/instructor/lessons/" + ids[0] + "/replay-review/publish"), instructor, null)
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/lessons/" + ids[0] + "/playback").cookie(student))
                .andExpect(status().isOk());
    }

    private String[] createActiveRecording(Cookie[] instructor, String manifest) throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        when(egressControl.startHlsRecording(any(), any())).thenReturn(egressId);
        stubManifest(manifest);
        String[] base = createSession(instructor);
        write(post("/api/live-sessions/" + base[1] + "/start"), instructor, null)
                .andExpect(status().isOk());
        return new String[]{base[0], base[1], base[2], egressId};
    }

    private String[] createReadyRecording(Cookie[] instructor, String manifest) throws Exception {
        String[] active = createActiveRecording(instructor, manifest);
        write(post("/api/live-sessions/" + active[1] + "/end"), instructor, null)
                .andExpect(status().isOk());
        completeRecording(active[3]);
        return active;
    }

    private void stubManifest(String manifest) {
        when(recordingStorage.findManifest(anyString(), anyString()))
                .thenReturn(manifest == null ? Optional.empty() : Optional.of(manifest));
        when(recordingStorage.presignSegment(anyString(), anyString(), any(Duration.class)))
                .thenAnswer(invocation -> "https://minio.local/"
                        + invocation.getArgument(0) + "/" + invocation.getArgument(1)
                        + "?X-Amz-Signature=stub");
    }

    private void completeRecording(String egressId) throws Exception {
        when(recordingStorage.head(any(), any())).thenReturn(Optional.of(10_485_760L));
        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE",
                "segmentResults":[{"playlistName":"index.m3u8","duration":"600000000000","size":"10485760","segmentCount":300}]}}
                """.formatted(egressId);
        postWebhook(body, sign(body)).andExpect(status().isNoContent());
    }

    private ResultActions postWebhook(String body, String jwt) throws Exception {
        return mockMvc.perform(post("/api/webhooks/livekit")
                .contentType(MediaType.APPLICATION_JSON)
                .header(HttpHeaders.AUTHORIZATION, jwt)
                .content(body));
    }

    private String sign(String body) {
        return JWT.create().withClaim("sha256", sha256Base64(body))
                .sign(Algorithm.HMAC256(livekit.apiSecret()));
    }

    private String sha256Base64(String body) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest(body.getBytes(StandardCharsets.UTF_8));
            return Base64.getEncoder().encodeToString(hash);
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    /** [0]=lessonId, [1]=sessionId, [2]=curriculumId. */
    private String[] createSession(Cookie[] instructor) throws Exception {
        String curriculumId = json(write(
                post("/api/instructor/curriculums"),
                instructor,
                "{\"title\":\"다시보기\"}").andReturn()).get("curriculumId").asString();
        String sectionId = json(write(
                post("/api/instructor/curriculums/" + curriculumId + "/sections"),
                instructor,
                "{\"title\":\"s\"}").andReturn()).get("sectionId").asString();
        String lessonId = json(write(
                post("/api/instructor/sections/" + sectionId + "/lessons"),
                instructor,
                "{\"title\":\"l\"}").andReturn()).get("lessonId").asString();
        String sessionId = json(write(
                post("/api/instructor/lessons/" + lessonId + "/live-sessions"),
                instructor,
                null).andReturn()).get("sessionId").asString();
        createdSessions.add(UUID.fromString(sessionId));
        return new String[]{lessonId, sessionId, curriculumId};
    }

    private void publishLesson(Cookie[] instructor, String lessonId) throws Exception {
        write(post("/api/instructor/lessons/" + lessonId + "/publish"), instructor, null)
                .andExpect(status().isOk());
    }

    private void approveEnrollment(Cookie[] instructor,
                                   Cookie[] student,
                                   String curriculumId) throws Exception {
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), instructor, null)
                .andExpect(status().isOk());
        String enrollmentId = json(write(
                post("/api/curriculums/" + curriculumId + "/enrollments"),
                student,
                null).andExpect(status().isCreated()).andReturn())
                .get("enrollmentId").asString();
        write(post("/api/instructor/curriculums/" + curriculumId
                        + "/enrollments/" + enrollmentId + "/approve"),
                instructor,
                null).andExpect(status().isOk());
    }

    private ResultActions write(MockHttpServletRequestBuilder builder,
                                Cookie[] authCookies,
                                String body) throws Exception {
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

    private Cookie[] loginAs(String role) throws Exception {
        String email = "replay-" + UUID.randomUUID() + "@liveclass.test";
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
