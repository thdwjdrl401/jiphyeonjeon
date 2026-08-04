package com.liveclass.video;

import com.liveclass.asset.service.AssetStorage;
import com.liveclass.video.domain.RecordedCaptionPublicationStatus;
import com.liveclass.video.domain.RecordedCaptionStatus;
import com.liveclass.video.domain.RecordedSttJobStatus;
import com.liveclass.video.domain.RecordedPublicationStatus;
import com.liveclass.video.domain.RecordedVideoStatus;
import com.liveclass.video.repository.RecordedCaptionTrackRepository;
import com.liveclass.video.repository.RecordedSttJobRepository;
import com.liveclass.video.repository.RecordedVideoRepository;
import com.liveclass.video.service.RecordedPublicationService;
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

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/** ADR-0011의 Spring↔recorded-stt-worker 계약과 영상/자막 독립 상태를 고정한다. */
@SpringBootTest(properties = "recorded.stt.enabled=true")
@AutoConfigureMockMvc
@Transactional
class RecordedSttContractTest {

    private static final String SOURCE_SECRET = "dev-recorded-stt-source-secret";
    private static final String CALLBACK_SECRET = "dev-recorded-stt-callback-secret";

    @Autowired
    private MockMvc mockMvc;
    @Autowired
    private RecordedCaptionTrackRepository trackRepository;
    @Autowired
    private RecordedSttJobRepository jobRepository;
    @Autowired
    private RecordedVideoRepository videoRepository;
    @Autowired
    private RecordedPublicationService publicationService;

    @MockitoBean
    private AssetStorage assetStorage;

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

    @Test
    void stt_first_remains_draft_until_hls_is_ready_then_publishes_idempotently() throws Exception {
        Cookie[] instructor = loginAsInstructor();
        String sectionId = createSection(instructor);
        MvcResult created = write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"),
                instructor, "{\"clientRequestId\":\"%s\",\"title\":\"STT 강의\"}"
                        .formatted(UUID.randomUUID()))
                .andExpect(status().isCreated()).andReturn();
        UUID lessonId = UUID.fromString(json(created).get("lessonId").asString());

        MvcResult ticket = write(post("/api/instructor/recorded-lessons/" + lessonId
                        + "/video/upload-requests"), instructor,
                "{\"fileName\":\"stt.mp4\",\"contentType\":\"video/mp4\",\"fileSize\":12}")
                .andExpect(status().isCreated()).andReturn();
        MvcResult accepted = write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/complete"),
                instructor, "{\"assetId\":\"" + json(ticket).get("assetId").asString() + "\"}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.captionStatus").value("PENDING"))
                .andExpect(jsonPath("$.captionProcessedChunks").value(0))
                .andReturn();
        UUID recordedVideoId = UUID.fromString(json(accepted).get("recordedVideoId").asString());
        var sttJob = jobRepository.findTopByRecordedVideoIdOrderByAttemptNoDesc(recordedVideoId).orElseThrow();
        assertThat(sttJob.getStatus()).isEqualTo(RecordedSttJobStatus.PENDING);

        byte[] empty = new byte[0];
        mockMvc.perform(post("/api/internal/ai/recorded-stt-jobs/" + sttJob.getId() + "/source-url")
                        .header("X-Signature", signature(SOURCE_SECRET, empty)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value("http://fake-minio/source-download.mp4"));
        mockMvc.perform(get("/api/internal/ai/recorded-stt-jobs/" + sttJob.getId() + "/progress")
                        .header("X-Signature", signature(CALLBACK_SECRET, empty)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("RUNNING"))
                .andExpect(jsonPath("$.completedChunks").isEmpty());

        String chunk = """
                {"eventId":"stt-chunk-one","sourceStartMs":0,"sourceEndMs":6000,
                 "sourceSha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                 "model":"whisper-1","language":"ko","segments":[
                   {"localSegmentIndex":0,"startMs":250,"endMs":1500,"text":"첫 번째 자막입니다."}
                 ]}
                """.strip();
        signedPut(sttJob.getId(), 0, chunk).andExpect(status().isNoContent());
        signedPut(sttJob.getId(), 0, chunk).andExpect(status().isNoContent());

        String conflictChunk = chunk.replace("첫 번째 자막입니다.", "다른 자막입니다.");
        signedPut(sttJob.getId(), 0, conflictChunk)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RECORDED_STT_CHUNK_CONFLICT"));

        String incomplete = terminal(sttJob.getId(), recordedVideoId, "terminal-incomplete", 2, 1);
        signedTerminal(incomplete)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RECORDED_STT_CHUNKS_INCOMPLETE"));

        String succeeded = terminal(sttJob.getId(), recordedVideoId, "terminal-succeeded", 1, 1);
        signedTerminal(succeeded).andExpect(status().isNoContent());
        signedTerminal(succeeded).andExpect(status().isNoContent());

        var track = trackRepository.findByRecordedVideoId(recordedVideoId).orElseThrow();
        assertThat(track.getStatus()).isEqualTo(RecordedCaptionStatus.READY);
        assertThat(track.getPublicationStatus()).isEqualTo(RecordedCaptionPublicationStatus.DRAFT);
        assertThat(track.getSegmentCount()).isEqualTo(1);
        assertThat(jobRepository.findById(sttJob.getId()).orElseThrow().getStatus())
                .isEqualTo(RecordedSttJobStatus.SUCCEEDED);

        mockMvc.perform(get("/api/instructor/recorded-lessons/" + lessonId + "/processing")
                        .cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("QUEUED"))
                .andExpect(jsonPath("$.captionStatus").value("READY"))
                .andExpect(jsonPath("$.captionProcessedChunks").value(1))
                .andExpect(jsonPath("$.captionTotalChunks").value(1));

        markVideoReady(recordedVideoId);
        assertThat(publicationService.tryAutoPublish(recordedVideoId)).isTrue();
        OffsetDateTime firstPublishedAt = videoRepository.findById(recordedVideoId).orElseThrow().getPublishedAt();
        assertThat(publicationService.tryAutoPublish(recordedVideoId)).isTrue();
        assertThat(videoRepository.findById(recordedVideoId).orElseThrow().getPublishedAt())
                .isEqualTo(firstPublishedAt);
        assertThat(trackRepository.findByRecordedVideoId(recordedVideoId).orElseThrow().getPublicationStatus())
                .isEqualTo(RecordedCaptionPublicationStatus.PUBLISHED);
    }

    @Test
    void internal_stt_endpoint_rejects_a_missing_signature() throws Exception {
        mockMvc.perform(get("/api/internal/ai/recorded-stt-jobs/" + UUID.randomUUID() + "/progress"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("RECORDED_STT_WORKER_UNAUTHORIZED"));
    }

    @Test
    void failed_caption_can_retry_without_changing_the_video_pipeline() throws Exception {
        Cookie[] instructor = loginAsInstructor();
        String sectionId = createSection(instructor);
        MvcResult created = write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"),
                instructor, "{\"clientRequestId\":\"%s\",\"title\":\"STT 재시도 강의\"}"
                        .formatted(UUID.randomUUID()))
                .andExpect(status().isCreated()).andReturn();
        UUID lessonId = UUID.fromString(json(created).get("lessonId").asString());
        MvcResult ticket = write(post("/api/instructor/recorded-lessons/" + lessonId
                        + "/video/upload-requests"), instructor,
                "{\"fileName\":\"retry.mp4\",\"contentType\":\"video/mp4\",\"fileSize\":12}")
                .andExpect(status().isCreated()).andReturn();
        MvcResult accepted = write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/complete"),
                instructor, "{\"assetId\":\"" + json(ticket).get("assetId").asString() + "\"}")
                .andExpect(status().isAccepted()).andReturn();
        UUID recordedVideoId = UUID.fromString(json(accepted).get("recordedVideoId").asString());
        var firstJob = jobRepository.findTopByRecordedVideoIdOrderByAttemptNoDesc(recordedVideoId).orElseThrow();

        String failed = """
                {"eventId":"terminal-failed","jobId":"%s","recordedVideoId":"%s","status":"FAILED",
                 "output":null,"failureCode":"SOURCE_AUDIO_MISSING"}
                """.formatted(firstJob.getId(), recordedVideoId).strip();
        signedTerminal(failed).andExpect(status().isNoContent());

        write(post("/api/instructor/recorded-lessons/" + lessonId + "/captions/retry"), instructor, null)
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.status").value("QUEUED"))
                .andExpect(jsonPath("$.captionStatus").value("PENDING"))
                .andExpect(jsonPath("$.captionProcessedChunks").value(0));

        var secondJob = jobRepository.findTopByRecordedVideoIdOrderByAttemptNoDesc(recordedVideoId).orElseThrow();
        assertThat(secondJob.getAttemptNo()).isEqualTo(2);
        assertThat(secondJob.getStatus()).isEqualTo(RecordedSttJobStatus.PENDING);
        assertThat(trackRepository.findByRecordedVideoId(recordedVideoId).orElseThrow().getStatus())
                .isEqualTo(RecordedCaptionStatus.PENDING);
    }

    @Test
    void hls_ready_then_stt_success_atomically_publishes_playback_with_webvtt() throws Exception {
        Cookie[] instructor = loginAsInstructor();
        UUID[] ids = createUploadedRecordedLesson(instructor, "자동 게시 자막 강의");
        UUID lessonId = ids[0];
        UUID recordedVideoId = ids[1];
        var sttJob = jobRepository.findTopByRecordedVideoIdOrderByAttemptNoDesc(recordedVideoId).orElseThrow();

        markVideoReady(recordedVideoId);
        mockMvc.perform(get("/api/lessons/" + lessonId + "/recorded-playback").cookie(instructor))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RECORDED_VIDEO_NOT_PUBLISHED"));
        UUID pendingTrackId = trackRepository.findByRecordedVideoId(recordedVideoId).orElseThrow().getId();
        mockMvc.perform(get("/api/lessons/" + lessonId + "/recorded-playback/captions/"
                        + pendingTrackId + ".vtt").cookie(instructor))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RECORDED_VIDEO_NOT_PUBLISHED"));

        String chunk = """
                {"eventId":"publish-chunk","sourceStartMs":0,"sourceEndMs":6000,
                 "sourceSha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                 "model":"whisper-1","language":"ko","segments":[
                   {"localSegmentIndex":0,"startMs":1250,"endMs":5880,
                    "text":"오늘은 스프링 시큐리티를 살펴보겠습니다."}
                 ]}
                """.strip();
        signedPut(sttJob.getId(), 0, chunk).andExpect(status().isNoContent());
        String succeeded = terminal(sttJob.getId(), recordedVideoId, "publish-terminal", 1, 1);
        signedTerminal(succeeded).andExpect(status().isNoContent());
        signedTerminal(succeeded).andExpect(status().isNoContent());

        var video = videoRepository.findById(recordedVideoId).orElseThrow();
        var track = trackRepository.findByRecordedVideoId(recordedVideoId).orElseThrow();
        assertThat(video.getPublicationStatus()).isEqualTo(RecordedPublicationStatus.PUBLISHED);
        assertThat(video.getPublishedAt()).isNotNull();
        assertThat(track.getPublicationStatus()).isEqualTo(RecordedCaptionPublicationStatus.PUBLISHED);
        assertThat(track.getPublishedAt()).isEqualTo(video.getPublishedAt());

        mockMvc.perform(get("/api/instructor/recorded-lessons/" + lessonId + "/processing")
                        .cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recordedPublicationStatus").value("PUBLISHED"))
                .andExpect(jsonPath("$.publishedAt").exists());

        mockMvc.perform(get("/api/lessons/" + lessonId + "/recorded-playback").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.recordedPublicationStatus").value("PUBLISHED"))
                .andExpect(jsonPath("$.captions.status").value("AVAILABLE"))
                .andExpect(jsonPath("$.captions.tracks[0].trackId").value(track.getId().toString()))
                .andExpect(jsonPath("$.captions.tracks[0].format").value("WEBVTT"))
                .andExpect(jsonPath("$.captions.tracks[0].default").value(true));

        mockMvc.perform(get("/api/lessons/" + lessonId + "/recorded-playback/captions/"
                        + track.getId() + ".vtt").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(result -> assertThat(result.getResponse().getContentType()).startsWith("text/vtt"))
                .andExpect(result -> assertThat(result.getResponse().getContentAsString())
                        .contains("WEBVTT", "00:00:01.250 --> 00:00:05.880", "스프링 시큐리티"));
    }

    @Test
    void empty_caption_is_a_normal_terminal_and_publishes_hls_without_tracks() throws Exception {
        Cookie[] instructor = loginAsInstructor();
        UUID[] ids = createUploadedRecordedLesson(instructor, "무발화 강의");
        UUID lessonId = ids[0];
        UUID recordedVideoId = ids[1];
        var sttJob = jobRepository.findTopByRecordedVideoIdOrderByAttemptNoDesc(recordedVideoId).orElseThrow();
        markVideoReady(recordedVideoId);

        String emptyChunk = """
                {"eventId":"empty-chunk","sourceStartMs":0,"sourceEndMs":6000,
                 "sourceSha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
                 "model":"whisper-1","language":"ko","segments":[]}
                """.strip();
        signedPut(sttJob.getId(), 0, emptyChunk).andExpect(status().isNoContent());
        signedTerminal(terminal(sttJob.getId(), recordedVideoId, "empty-terminal", 1, 0))
                .andExpect(status().isNoContent());

        var track = trackRepository.findByRecordedVideoId(recordedVideoId).orElseThrow();
        assertThat(track.getStatus()).isEqualTo(RecordedCaptionStatus.EMPTY);
        assertThat(videoRepository.findById(recordedVideoId).orElseThrow().getPublicationStatus())
                .isEqualTo(RecordedPublicationStatus.PUBLISHED);

        mockMvc.perform(get("/api/lessons/" + lessonId + "/recorded-playback").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.captions.status").value("EMPTY"))
                .andExpect(jsonPath("$.captions.tracks").isEmpty());
        write(post("/api/instructor/recorded-lessons/" + lessonId + "/captions/retry"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("RECORDED_CAPTION_RETRY_CONFLICT"));
    }

    private UUID[] createUploadedRecordedLesson(Cookie[] instructor, String title) throws Exception {
        String sectionId = createSection(instructor);
        MvcResult created = write(post("/api/instructor/sections/" + sectionId + "/recorded-lessons"),
                instructor, "{\"clientRequestId\":\"%s\",\"title\":\"%s\"}"
                        .formatted(UUID.randomUUID(), title))
                .andExpect(status().isCreated()).andReturn();
        UUID lessonId = UUID.fromString(json(created).get("lessonId").asString());
        MvcResult ticket = write(post("/api/instructor/recorded-lessons/" + lessonId
                        + "/video/upload-requests"), instructor,
                "{\"fileName\":\"publish.mp4\",\"contentType\":\"video/mp4\",\"fileSize\":12}")
                .andExpect(status().isCreated()).andReturn();
        MvcResult accepted = write(post("/api/instructor/recorded-lessons/" + lessonId + "/video/complete"),
                instructor, "{\"assetId\":\"" + json(ticket).get("assetId").asString() + "\"}")
                .andExpect(status().isAccepted())
                .andExpect(jsonPath("$.recordedPublicationStatus").value("DRAFT"))
                .andReturn();
        return new UUID[]{lessonId, UUID.fromString(json(accepted).get("recordedVideoId").asString())};
    }

    private void markVideoReady(UUID recordedVideoId) {
        var video = videoRepository.findById(recordedVideoId).orElseThrow();
        video.setStatus(RecordedVideoStatus.READY);
        video.setOutputBucket("recordings");
        video.setHlsManifestKey("recorded/" + recordedVideoId + "/index.m3u8");
        video.setDurationMs(6_000L);
        video.setSizeBytes(100L);
        video.setSegmentCount(1);
        video.setFailureCode(null);
        video.setReadyAt(OffsetDateTime.now());
        videoRepository.saveAndFlush(video);
    }

    private String terminal(UUID jobId, UUID videoId, String eventId, int chunks, int segments) {
        return """
                {"eventId":"%s","jobId":"%s","recordedVideoId":"%s","status":"SUCCEEDED",
                 "output":{"model":"whisper-1","language":"ko","durationMs":6000,
                 "chunkCount":%d,"segmentCount":%d},"failureCode":null}
                """.formatted(eventId, jobId, videoId, chunks, segments).strip();
    }

    private org.springframework.test.web.servlet.ResultActions signedPut(
            UUID jobId, int chunkIndex, String body) throws Exception {
        byte[] raw = body.getBytes(StandardCharsets.UTF_8);
        return mockMvc.perform(put("/api/internal/ai/recorded-stt-jobs/" + jobId + "/chunks/" + chunkIndex)
                .contentType(MediaType.APPLICATION_JSON).content(raw)
                .header("X-Signature", signature(CALLBACK_SECRET, raw)));
    }

    private org.springframework.test.web.servlet.ResultActions signedTerminal(String body) throws Exception {
        byte[] raw = body.getBytes(StandardCharsets.UTF_8);
        return mockMvc.perform(post("/api/internal/ai/recorded-stt-callbacks")
                .contentType(MediaType.APPLICATION_JSON).content(raw)
                .header("X-Signature", signature(CALLBACK_SECRET, raw)));
    }

    private String createSection(Cookie[] auth) throws Exception {
        MvcResult curriculum = write(post("/api/instructor/curriculums"), auth,
                "{\"title\":\"녹화 STT 테스트\"}")
                .andExpect(status().isCreated()).andReturn();
        MvcResult section = write(post("/api/instructor/curriculums/"
                        + json(curriculum).get("curriculumId").asString() + "/sections"), auth,
                "{\"title\":\"섹션\"}")
                .andExpect(status().isCreated()).andReturn();
        return json(section).get("sectionId").asString();
    }

    private Cookie[] loginAsInstructor() throws Exception {
        String email = "recorded-stt-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null,
                "{\"email\":\"%s\",\"password\":\"password123\",\"displayName\":\"테스터\",\"role\":\"INSTRUCTOR\"}"
                        .formatted(email))
                .andExpect(status().isCreated());
        return write(post("/api/auth/login"), null,
                "{\"email\":\"%s\",\"password\":\"password123\"}".formatted(email))
                .andExpect(status().isOk()).andReturn().getResponse().getCookies();
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

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }

    private String signature(String secret, byte[] body) throws Exception {
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        return Base64.getEncoder().encodeToString(mac.doFinal(body));
    }
}
