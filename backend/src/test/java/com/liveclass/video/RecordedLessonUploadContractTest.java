package com.liveclass.video;

import com.liveclass.asset.service.AssetStorage;
import com.liveclass.video.domain.MediaTranscodeJobStatus;
import com.liveclass.video.domain.RecordedVideoStatus;
import com.liveclass.video.repository.MediaTranscodeJobRepository;
import com.liveclass.video.repository.RecordedVideoRepository;
import com.liveclass.video.service.RecordingStorage;
import com.liveclass.video.service.ReplayStorage;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** ADR-0008의 새 URL·camelCase·201/202·소유권·job commit 경계를 고정한다. */
@SpringBootTest(properties = "recorded.stt.enabled=true")
@AutoConfigureMockMvc
@Transactional
class RecordedLessonUploadContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private RecordedVideoRepository recordedVideoRepository;

    @Autowired
    private MediaTranscodeJobRepository jobRepository;

    @MockitoBean
    private AssetStorage assetStorage;

    @MockitoBean
    private ReplayStorage replayStorage;

    @MockitoBean
    private RecordingStorage recordingStorage;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @BeforeEach
    void storage() {
        when(assetStorage.presignUpload(anyString(), anyString(), anyLong(), any(Duration.class)))
                .thenReturn(new AssetStorage.PresignedUpload(
                        "http://fake-minio/source.mp4", OffsetDateTime.now().plusMinutes(10)));
        when(assetStorage.head(anyString()))
                .thenReturn(Optional.of(new AssetStorage.StoredObject(12L, "video/mp4")));
        when(assetStorage.presignDownload(anyString(), any(Duration.class)))
                .thenReturn("http://fake-minio/source-download.mp4");
    }

    /**
     * 스위치가 둘 다 열린 환경에서는 화면을 잠그지 않는다. 닫힌 쪽은
     * {@code RecordedSttRequiredContractTest}가 본다.
     */
    @Test
    void capabilities_report_both_switches_open() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");

        mockMvc.perform(get("/api/instructor/recorded-lessons/capabilities").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.videoUploadEnabled").value(true))
                .andExpect(jsonPath("$.captionGenerationEnabled").value(true));
    }

    @Test
    void creates_uploads_and_commits_transcode_job() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sectionId = createSection(instructor);
        UUID clientRequestId = UUID.randomUUID();

        MvcResult created = write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"), instructor, """
                {"clientRequestId":"%s","title":"녹화 보안 강의","description":"설명"}
                """.formatted(clientRequestId))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.lessonId").exists())
                .andExpect(jsonPath("$.recordedVideoId").exists())
                .andExpect(jsonPath("$.deliveryType").value("RECORDED"))
                .andExpect(jsonPath("$.processingStatus").value("AWAITING_UPLOAD"))
                .andExpect(jsonPath("$.recorded_video_id").doesNotExist())
                .andReturn();
        UUID lessonId = UUID.fromString(json(created).get("lessonId").asString());

        MvcResult ticket = write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/upload-requests"), instructor, """
                {"fileName":"lecture.mp4","contentType":"video/mp4","fileSize":12}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.assetId").exists())
                .andExpect(jsonPath("$.uploadUrl").value("http://fake-minio/source.mp4"))
                .andExpect(jsonPath("$.method").value("PUT"))
                .andReturn();
        String assetId = json(ticket).get("assetId").asString();

        MvcResult accepted = write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/complete"), instructor,
                "{\"assetId\":\"" + assetId + "\"}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.lessonId").value(lessonId.toString()))
                .andExpect(jsonPath("$.jobId").exists())
                .andExpect(jsonPath("$.status").value("QUEUED"))
                .andReturn();

        UUID recordedVideoId = UUID.fromString(json(accepted).get("recordedVideoId").asString());
        assertThat(recordedVideoRepository.findById(recordedVideoId).orElseThrow().getStatus())
                .isEqualTo(RecordedVideoStatus.QUEUED);
        assertThat(jobRepository.findTopByRecordedVideoIdOrderByAttemptNoDesc(recordedVideoId).orElseThrow().getStatus())
                .isEqualTo(MediaTranscodeJobStatus.PENDING);

        mockMvc.perform(get("/api/instructor/recorded-lessons/" + lessonId + "/processing").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("QUEUED"));
    }

    @Test
    void create_is_idempotent_but_conflicting_payload_is_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sectionId = createSection(instructor);
        UUID requestId = UUID.randomUUID();
        String body = "{\"clientRequestId\":\"%s\",\"title\":\"같은 강의\"}".formatted(requestId);

        String firstLesson = json(write(
                post("/api/instructor/sections/" + sectionId + "/recorded-lessons"), instructor, body)
                .andExpect(status().isCreated()).andReturn()).get("lessonId").asString();
        write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"), instructor, body)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.lessonId").value(firstLesson));

        write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"), instructor,
                "{\"clientRequestId\":\"%s\",\"title\":\"다른 강의\"}".formatted(requestId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RECORDED_LESSON_IDEMPOTENCY_CONFLICT"));
    }

    @Test
    void generic_asset_api_cannot_create_recorded_source() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        write(post("/api/assets/upload-requests"), instructor, """
                {"kind":"RECORDED_VIDEO_SOURCE","fileName":"lecture.mp4","contentType":"video/mp4","fileSize":12}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ASSET_KIND_NOT_PUBLIC"));
    }

    @Test
    void recorded_source_accepts_exactly_5_gib_but_rejects_one_more_byte() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sectionId = createSection(instructor);
        MvcResult created = write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"),
                instructor, "{\"clientRequestId\":\"%s\",\"title\":\"크기 경계 강의\"}"
                        .formatted(UUID.randomUUID()))
                .andExpect(status().isCreated())
                .andReturn();
        String lessonId = json(created).get("lessonId").asString();

        write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/upload-requests"), instructor,
                "{\"fileName\":\"limit.mp4\",\"contentType\":\"video/mp4\",\"fileSize\":5368709120}")
                .andExpect(status().isCreated());

        write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/upload-requests"), instructor,
                "{\"fileName\":\"too-big.mp4\",\"contentType\":\"video/mp4\",\"fileSize\":5368709121}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("RECORDED_VIDEO_INVALID"));
    }

    @Test
    void another_instructor_cannot_issue_upload_ticket() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String sectionId = createSection(owner);
        MvcResult created = write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"), owner,
                "{\"clientRequestId\":\"%s\",\"title\":\"내 강의\"}".formatted(UUID.randomUUID()))
                .andExpect(status().isCreated()).andReturn();

        Cookie[] intruder = loginAs("INSTRUCTOR");
        write(post("/api/instructor/recorded-lessons/" + json(created).get("lessonId").asString()
                        + "/video/upload-requests"), intruder,
                "{\"fileName\":\"x.mp4\",\"contentType\":\"video/mp4\",\"fileSize\":12}")
                .andExpect(status().isForbidden());
    }

    @Test
    void processing_recorded_lesson_cannot_be_deleted() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sectionId = createSection(instructor);
        MvcResult created = write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"), instructor,
                "{\"clientRequestId\":\"%s\",\"title\":\"삭제 보호 강의\"}".formatted(UUID.randomUUID()))
                .andExpect(status().isCreated()).andReturn();
        String lessonId = json(created).get("lessonId").asString();
        MvcResult ticket = write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/upload-requests"),
                instructor, "{\"fileName\":\"busy.mp4\",\"contentType\":\"video/mp4\",\"fileSize\":12}")
                .andExpect(status().isCreated()).andReturn();
        write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/complete"), instructor,
                "{\"assetId\":\"" + json(ticket).get("assetId").asString() + "\"}")
                .andExpect(status().isAccepted());

        write(delete("/api/instructor/lessons/" + lessonId), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RECORDED_VIDEO_DELETE_WHILE_PROCESSING"));
    }

    @Test
    void failed_processing_can_be_retried_but_active_processing_cannot() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sectionId = createSection(instructor);
        MvcResult created = write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"), instructor,
                "{\"clientRequestId\":\"%s\",\"title\":\"재시도 강의\"}".formatted(UUID.randomUUID()))
                .andExpect(status().isCreated()).andReturn();
        String lessonId = json(created).get("lessonId").asString();
        MvcResult ticket = write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/upload-requests"),
                instructor, "{\"fileName\":\"retry.mp4\",\"contentType\":\"video/mp4\",\"fileSize\":12}")
                .andExpect(status().isCreated()).andReturn();
        MvcResult accepted = write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/complete"),
                instructor, "{\"assetId\":\"" + json(ticket).get("assetId").asString() + "\"}")
                .andExpect(status().isAccepted()).andReturn();
        UUID recordedVideoId = UUID.fromString(json(accepted).get("recordedVideoId").asString());

        // 처리 중 작업은 중복 attempt를 만들지 않는다.
        write(post("/api/instructor/recorded-lessons/" + lessonId + "/processing/retry"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RECORDED_VIDEO_RETRY_CONFLICT"));

        var video = recordedVideoRepository.findById(recordedVideoId).orElseThrow();
        var firstJob = jobRepository.findTopByRecordedVideoIdOrderByAttemptNoDesc(recordedVideoId).orElseThrow();
        video.setStatus(RecordedVideoStatus.FAILED);
        video.setFailureCode("FFMPEG_FAILED");
        firstJob.setStatus(MediaTranscodeJobStatus.FAILED);
        firstJob.setFinishedAt(OffsetDateTime.now());
        firstJob.setLastError("FFMPEG_FAILED");
        recordedVideoRepository.saveAndFlush(video);
        jobRepository.saveAndFlush(firstJob);

        MvcResult retried = write(post("/api/instructor/recorded-lessons/" + lessonId + "/processing/retry"),
                instructor, null)
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("QUEUED"))
                .andExpect(jsonPath("$.failureCode").isEmpty())
                .andReturn();

        UUID retryJobId = UUID.fromString(json(retried).get("jobId").asString());
        assertThat(retryJobId).isNotEqualTo(firstJob.getId());
        assertThat(jobRepository.findById(retryJobId).orElseThrow().getAttemptNo()).isEqualTo(2);
        assertThat(recordedVideoRepository.findById(recordedVideoId).orElseThrow().getStatus())
                .isEqualTo(RecordedVideoStatus.QUEUED);
    }

    @Test
    void another_instructor_cannot_retry_failed_processing() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String sectionId = createSection(owner);
        MvcResult created = write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"), owner,
                "{\"clientRequestId\":\"%s\",\"title\":\"소유권 재시도\"}".formatted(UUID.randomUUID()))
                .andExpect(status().isCreated()).andReturn();
        String lessonId = json(created).get("lessonId").asString();

        Cookie[] intruder = loginAs("INSTRUCTOR");
        write(post("/api/instructor/recorded-lessons/" + lessonId + "/processing/retry"), intruder, null)
                .andExpect(status().isForbidden());
    }

    @Test
    void signed_worker_callback_verifies_hls_and_opens_recorded_playback_idempotently() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sectionId = createSection(instructor);
        MvcResult created = write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"), instructor,
                "{\"clientRequestId\":\"%s\",\"title\":\"변환 완료 강의\"}".formatted(UUID.randomUUID()))
                .andExpect(status().isCreated()).andReturn();
        String lessonId = json(created).get("lessonId").asString();

        MvcResult ticket = write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/upload-requests"),
                instructor, "{\"fileName\":\"ready.mp4\",\"contentType\":\"video/mp4\",\"fileSize\":12}")
                .andExpect(status().isCreated()).andReturn();
        MvcResult accepted = write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/complete"),
                instructor, "{\"assetId\":\"" + json(ticket).get("assetId").asString() + "\"}")
                .andExpect(status().isAccepted()).andReturn();
        UUID recordedVideoId = UUID.fromString(json(accepted).get("recordedVideoId").asString());
        UUID jobId = UUID.fromString(json(accepted).get("jobId").asString());

        // 실제 소비가 dispatcher의 DISPATCHED 커밋보다 빠른 경우에도 PENDING job의 source URL이 열린다.
        byte[] empty = new byte[0];
        mockMvc.perform(post("/api/internal/media/transcode-jobs/" + jobId + "/source-url")
                        .header("X-Signature", signature("dev-media-source-secret", empty)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value("http://fake-minio/source-download.mp4"));

        String running = """
                {"eventId":"event-running","jobId":"%s","recordedVideoId":"%s","status":"RUNNING"}
                """.formatted(jobId, recordedVideoId).trim();
        signedCallback(running).andExpect(status().isOk());
        assertThat(recordedVideoRepository.findById(recordedVideoId).orElseThrow().getStatus())
                .isEqualTo(RecordedVideoStatus.TRANSCODING);

        String manifestKey = "recorded/" + recordedVideoId + "/index.m3u8";
        String manifest = """
                #EXTM3U
                #EXT-X-TARGETDURATION:6
                #EXTINF:6.0,
                segment-000001.ts
                #EXT-X-ENDLIST
                """;
        when(replayStorage.findManifest("recordings", manifestKey)).thenReturn(Optional.of(manifest));
        when(recordingStorage.head("recordings", "recorded/" + recordedVideoId + "/segment-000001.ts"))
                .thenReturn(Optional.of(100L));
        when(replayStorage.presignSegment(anyString(), anyString(), any(Duration.class)))
                .thenReturn("https://storage.example/segment.ts");

        String succeeded = """
                {"eventId":"event-succeeded","jobId":"%s","recordedVideoId":"%s","status":"SUCCEEDED",
                 "output":{"bucket":"recordings","hlsManifestKey":"%s","durationMs":6000,
                 "sizeBytes":100,"segmentCount":1}}
                """.formatted(jobId, recordedVideoId, manifestKey).trim();
        signedCallback(succeeded).andExpect(status().isOk());
        // 같은 eventId 재전송은 inbox에서 멱등하게 끝난다.
        signedCallback(succeeded).andExpect(status().isOk());

        assertThat(recordedVideoRepository.findById(recordedVideoId).orElseThrow().getStatus())
                .isEqualTo(RecordedVideoStatus.READY);
        assertThat(jobRepository.findById(jobId).orElseThrow().getStatus())
                .isEqualTo(MediaTranscodeJobStatus.SUCCEEDED);

        mockMvc.perform(get("/api/lessons/" + lessonId + "/recorded-playback").cookie(instructor))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RECORDED_VIDEO_NOT_PUBLISHED"));
        mockMvc.perform(get("/api/lessons/" + lessonId + "/recorded-playback/manifest").cookie(instructor))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RECORDED_VIDEO_NOT_PUBLISHED"));
        mockMvc.perform(get("/api/instructor/recorded-lessons/" + lessonId + "/processing").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("READY"))
                .andExpect(jsonPath("$.captionStatus").value("PENDING"))
                .andExpect(jsonPath("$.recordedPublicationStatus").value("DRAFT"))
                .andExpect(jsonPath("$.publishedAt").doesNotExist());
    }

    private String createSection(Cookie[] auth) throws Exception {
        MvcResult curriculum = write(post("/api/instructor/curriculums"), auth, "{\"title\":\"녹화 테스트\"}")
                .andExpect(status().isCreated()).andReturn();
        MvcResult section = write(post("/api/instructor/curriculums/"
                        + json(curriculum).get("curriculumId").asString() + "/sections"), auth,
                "{\"title\":\"섹션\"}")
                .andExpect(status().isCreated()).andReturn();
        return json(section).get("sectionId").asString();
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
        builder.cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "recorded-" + UUID.randomUUID() + "@liveclass.test";
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

    private org.springframework.test.web.servlet.ResultActions signedCallback(String body) throws Exception {
        byte[] raw = body.getBytes(StandardCharsets.UTF_8);
        return mockMvc.perform(post("/api/internal/media/transcode-callbacks")
                .contentType(MediaType.APPLICATION_JSON)
                .content(raw)
                .header("X-Signature", signature("dev-media-callback-secret", raw)));
    }

    private String signature(String secret, byte[] body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return Base64.getEncoder().encodeToString(mac.doFinal(body));
    }
}
