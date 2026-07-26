package com.liveclass.video;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.liveclass.live.api.LiveKitServerAccess;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.service.EgressControl;
import com.liveclass.video.service.ReplayManifestMissingException;
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
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 다시보기 재생·게시 계약(ADR-0039). {@link com.liveclass.video.LiveKitWebhookContractTest}와 같은 계열 —
 * 실커밋 흐름(비-@Transactional)으로 라이브 세션을 시작→종료→webhook 완료까지 몰아 READY 자산을 만든다.
 *
 * <p>검증 포인트: 재생 200 응답 형태(필드명), 미수강 403 ENROLLMENT_REQUIRED, 미게시 학생 404,
 * 자산 미준비 409, 소유 강사 검수(미게시도 조회 가능), 게시 성공/조건 위반(비소유 403·미준비 409)·멱등.
 */
@SpringBootTest
@AutoConfigureMockMvc
class ReplayPlaybackContractTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private VideoAssetRepository videoAssetRepository;
    @Autowired private LiveKitServerAccess livekit;

    @MockitoBean private EgressControl egressControl;
    @MockitoBean private LiveRoomControl roomControl;
    // S3RecordingStorage가 RecordingStorage(webhook VERIFYING)·ReplayStorage(재생) 둘 다 구현 —
    // 콘크리트 타입으로 모킹해야 두 포트 모두 이 목으로 주입된다.
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

    /** {@code ./} 상대 URI 정규화 + {@code #EXT-X-MAP}(fMP4 초기화 세그먼트) 태그 내부 URI 재작성 검증용. */
    private static final String FMP4_MANIFEST = """
            #EXTM3U
            #EXT-X-VERSION:7
            #EXT-X-TARGETDURATION:2
            #EXT-X-PLAYLIST-TYPE:VOD
            #EXT-X-PROGRAM-DATE-TIME:2026-07-26T10:00:00.000Z
            #EXT-X-MAP:URI="./init.mp4"
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
    void owner_instructor_can_play_before_publish() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);
        String lessonId = ids[0];

        mockMvc.perform(get("/api/lessons/" + lessonId + "/playback").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.manifest").value(org.hamcrest.Matchers.containsString("seg_00000.ts?")))
                .andExpect(jsonPath("$.sessionOffsetMs").isNumber())
                .andExpect(jsonPath("$.durationMs").value(600_000));
    }

    @Test
    void enrolled_student_can_play_published_replay() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);
        String lessonId = ids[0];
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, ids[2]);

        write(post("/api/instructor/lessons/" + lessonId + "/replay-review/publish"), instructor, null)
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/lessons/" + lessonId + "/playback").cookie(student))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.manifest").exists())
                .andExpect(jsonPath("$.sessionOffsetMs").isNumber())
                .andExpect(jsonPath("$.durationMs").value(600_000));
    }

    @Test
    void unenrolled_user_gets_403_enrollment_required() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);
        String lessonId = ids[0];
        Cookie[] outsider = loginAs("STUDENT");

        mockMvc.perform(get("/api/lessons/" + lessonId + "/playback").cookie(outsider))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_REQUIRED"));
    }

    @Test
    void enrolled_student_gets_404_when_not_published() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);
        String lessonId = ids[0];
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, ids[2]);
        // 게시(publish) 호출 없음 — 자산은 READY지만 replayStatus는 아직 DRAFT.

        mockMvc.perform(get("/api/lessons/" + lessonId + "/playback").cookie(student))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("REPLAY_NOT_FOUND"));
    }

    @Test
    void owner_gets_409_when_asset_not_ready() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        when(egressControl.startHlsRecording(any(), any())).thenReturn("EG_" + UUID.randomUUID());
        String[] ids = createSession(instructor);
        String lessonId = ids[0];
        String sessionId = ids[1];
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isOk());
        // 종료 없이 RECORDING 상태 그대로 — 자산이 READY가 아니다.

        mockMvc.perform(get("/api/lessons/" + lessonId + "/playback").cookie(instructor))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REPLAY_NOT_READY"));
    }

    @Test
    void ready_asset_with_missing_manifest_returns_409_not_500() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String egressId = "EG_" + UUID.randomUUID();
        when(egressControl.startHlsRecording(any(), any())).thenReturn(egressId);
        when(recordingStorage.head(any(), any())).thenReturn(java.util.Optional.of(10_485_760L));
        // retention_until 만료 등으로 자산은 READY인데 스토리지에서 파일만 먼저 사라진 엣지케이스.
        doThrow(new ReplayManifestMissingException("gone"))
                .when(recordingStorage).readManifest(any(), any());

        String[] ids = createSession(instructor);
        String lessonId = ids[0];
        String sessionId = ids[1];
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isOk());
        write(post("/api/live-sessions/" + sessionId + "/end"), instructor, null).andExpect(status().isOk());
        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE",
                "segmentResults":[{"playlistName":"index.m3u8","duration":"600000000000","size":"10485760","segmentCount":300}]}}
                """.formatted(egressId);
        postWebhook(body, sign(body)).andExpect(status().isNoContent());

        mockMvc.perform(get("/api/lessons/" + lessonId + "/playback").cookie(instructor))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REPLAY_NOT_READY"));
    }

    @Test
    void manifest_rewriting_normalizes_relative_uris_and_map_tag() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor, FMP4_MANIFEST);
        String lessonId = ids[0];

        MvcResult result = mockMvc.perform(get("/api/lessons/" + lessonId + "/playback").cookie(instructor))
                .andExpect(status().isOk())
                .andReturn();
        String manifest = json(result).get("manifest").asString();

        // "./" 제거 후 presign — 정규화된 키(seg_00000.m4s)로 presign이 호출됐어야 한다(선행 "./"가 남지 않음).
        assertThat(manifest).contains("seg_00000.m4s?").doesNotContain("./seg_00000.m4s?");
        assertThat(manifest).contains("seg_00001.m4s?");
        // #EXT-X-MAP 태그 내부 URI="..."도 presigned URL로 재작성됨(원래 상대경로 그대로 남지 않음).
        assertThat(manifest).contains("#EXT-X-MAP:URI=\"").contains("init.mp4?").doesNotContain("URI=\"./init.mp4\"");
    }

    @Test
    void publish_by_non_owner_instructor_is_forbidden() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);
        String lessonId = ids[0];
        Cookie[] other = loginAs("INSTRUCTOR");

        write(post("/api/instructor/lessons/" + lessonId + "/replay-review/publish"), other, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("REPLAY_FORBIDDEN"));
    }

    @Test
    void publish_before_asset_ready_is_conflict() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        when(egressControl.startHlsRecording(any(), any())).thenReturn("EG_" + UUID.randomUUID());
        String[] ids = createSession(instructor);
        String lessonId = ids[0];
        String sessionId = ids[1];
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isOk());

        write(post("/api/instructor/lessons/" + lessonId + "/replay-review/publish"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("REPLAY_PUBLISH_CONFLICT"));
    }

    @Test
    void publish_is_idempotent() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createReadyRecording(instructor);
        String lessonId = ids[0];

        write(post("/api/instructor/lessons/" + lessonId + "/replay-review/publish"), instructor, null)
                .andExpect(status().isNoContent());
        // 두 번째 게시도 안전 — 이미 PUBLISHED.
        write(post("/api/instructor/lessons/" + lessonId + "/replay-review/publish"), instructor, null)
                .andExpect(status().isNoContent());
    }

    // ---- 헬퍼 ----

    /** 세션을 만들고 라이브 시작→종료→webhook 완료까지 몰아 READY 자산을 만든다. [0]=lessonId, [1]=sessionId, [2]=curriculumId. */
    private String[] createReadyRecording(Cookie[] instructor) throws Exception {
        return createReadyRecording(instructor, MANIFEST);
    }

    private String[] createReadyRecording(Cookie[] instructor, String manifest) throws Exception {
        String egressId = "EG_" + UUID.randomUUID();
        when(egressControl.startHlsRecording(any(), any())).thenReturn(egressId);
        when(recordingStorage.head(any(), any())).thenReturn(java.util.Optional.of(10_485_760L));
        when(recordingStorage.readManifest(any(), any())).thenReturn(manifest);
        when(recordingStorage.presignSegment(anyString(), anyString(), any(Duration.class)))
                .thenAnswer(inv -> "https://minio.local/" + inv.getArgument(0) + "/" + inv.getArgument(1) + "?X-Amz-Signature=stub");

        String[] ids = createSession(instructor);
        String sessionId = ids[1];
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isOk());
        write(post("/api/live-sessions/" + sessionId + "/end"), instructor, null).andExpect(status().isOk());

        String body = """
                {"event":"egress_ended","egressInfo":{"egressId":"%s","status":"EGRESS_COMPLETE",
                "segmentResults":[{"playlistName":"index.m3u8","duration":"600000000000","size":"10485760","segmentCount":300}]}}
                """.formatted(egressId);
        postWebhook(body, sign(body)).andExpect(status().isNoContent());
        return ids;
    }

    private ResultActions postWebhook(String body, String jwt) throws Exception {
        return mockMvc.perform(post("/api/webhooks/livekit")
                .contentType(MediaType.APPLICATION_JSON)
                .header("Authorization", jwt)
                .content(body));
    }

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

    /** [0]=lessonId, [1]=sessionId, [2]=curriculumId. */
    private String[] createSession(Cookie[] instructor) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"다시보기\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), instructor, "{\"title\":\"s\"}")
                .andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sid + "/lessons"), instructor, "{\"title\":\"l\"}")
                .andReturn()).get("lessonId").asString();
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), instructor, null)
                .andReturn()).get("sessionId").asString();
        createdSessions.add(UUID.fromString(sessionId));
        return new String[]{lessonId, sessionId, cid};
    }

    private void approveEnrollment(Cookie[] instructor, Cookie[] student, String curriculumId) throws Exception {
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
