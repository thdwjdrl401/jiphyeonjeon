package com.liveclass.curriculum;

import com.liveclass.live.domain.ChatMessage;
import com.liveclass.live.repository.ChatMessageRepository;
import com.liveclass.video.domain.ReplayStatus;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.service.S3RecordingStorage;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 녹화가 있는 강의 삭제 계약.
 *
 * <p>{@code video_asset}이 {@code lesson}을 NO ACTION FK로 참조해, 라이브를 한 번이라도 한 강의는 삭제가
 * DB에서 막혔다. 게다가 그 실패가 전역 핸들러에서 <b>"구조가 동시에 변경되었습니다. 다시 시도해 주세요"</b>
 * (409)로 번역돼, 될 리 없는 일을 재시도하라고 안내하고 있었다. 운영 로그에도 그 FK 위반이 남아 있다.
 *
 * <p><b>실커밋으로 돌린다.</b> NO ACTION FK는 문장 끝에 검사되므로, 롤백되는 트랜잭션 테스트에서는 그
 * 검사에 닿지 않아 <b>고쳐지지 않았어도 통과</b>한다 — 그런 테스트는 회귀를 못 잡는다. 만든 커리큘럼은
 * 뒤에서 지운다(섹션·레슨은 CASCADE).
 */
@SpringBootTest
@AutoConfigureMockMvc
class LessonDeleteWithRecordingContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private VideoAssetRepository videoAssetRepository;

    @Autowired
    private ChatMessageRepository chatMessageRepository;

    /**
     * 실제 MinIO를 부르지 않게 막는다. 파일 삭제는 커밋 뒤에 일어나므로 이 테스트에서 실제로 호출된다.
     * 인터페이스가 아니라 구현체를 목으로 둔다 — 이 빈 하나가 RecordingStorage와 ReplayStorage를 함께
     * 만족시키고 있어서, 인터페이스만 갈아끼우면 다른 쪽 주입이 깨진다.
     */
    @MockitoBean
    private S3RecordingStorage recordingStorage;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private final List<String> createdCurricula = new ArrayList<>();
    private Cookie[] auth;

    @AfterEach
    void cleanup() throws Exception {
        for (String curriculumId : createdCurricula) {
            if (auth != null && auth.length > 0) {
                mockMvc.perform(delete("/api/instructor/curriculums/" + curriculumId).cookie(auth).with(csrf()));
            }
        }
        createdCurricula.clear();
    }

    @Test
    void deleting_a_lesson_that_has_a_recording_succeeds_and_removes_the_asset() throws Exception {
        auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        String sectionId = createSection(auth, curriculumId);
        String lessonId = createLesson(auth, sectionId);
        String sessionId = createLiveSession(auth, lessonId);

        UUID assetId = seedRecording(UUID.fromString(lessonId), UUID.fromString(sessionId));
        when(recordingStorage.deletePrefix(anyString(), anyString())).thenReturn(3L);

        write(delete("/api/instructor/lessons/" + lessonId), auth, null)
                .andExpect(status().isNoContent());

        assertThat(videoAssetRepository.findById(assetId))
                .as("강의를 지우면 그 녹화 자산도 남지 않는다").isEmpty();
        // 산출물은 세션 단위 prefix로 지운다 — 행만 지우면 스토리지에 파일이 영원히 남는다.
        verify(recordingStorage).deletePrefix(anyString(), eq("sessions/" + sessionId));
    }

    /**
     * 실제로 라이브를 한 강의는 채팅이 남는다. {@code chat_message}도 {@code lesson}을 NO ACTION FK로
     * 참조하므로 video_asset과 <b>똑같은 이유로</b> 삭제를 막는다 — "다시보기 준비 중" 강의가 안 지워진
     * 실제 증상이 이것이다. 녹화만 seed하는 위 테스트는 이걸 못 잡는다.
     */
    @Test
    void deleting_a_lesson_that_had_chat_succeeds() throws Exception {
        auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        String sectionId = createSection(auth, curriculumId);
        String lessonId = createLesson(auth, sectionId);
        String sessionId = createLiveSession(auth, lessonId);

        seedRecording(UUID.fromString(lessonId), UUID.fromString(sessionId));
        seedChatMessage(UUID.fromString(lessonId), UUID.fromString(sessionId), currentUserId(auth));
        when(recordingStorage.deletePrefix(anyString(), anyString())).thenReturn(0L);

        write(delete("/api/instructor/lessons/" + lessonId), auth, null)
                .andExpect(status().isNoContent());
    }

    /**
     * 같은 결함이 커리큘럼에도 있었다. {@code live_session.curriculum_id}는 접근 게이팅용 비정규화
     * 열인데 NO ACTION이라, 라이브 일정을 한 번이라도 잡은 초안 커리큘럼이 지워지지 않았다.
     *
     * <p>녹화까지 함께 둔다. 자산 행은 CASCADE로 지워지지 않으므로(일부러 NO ACTION), 커리큘럼 삭제도
     * 레슨 삭제와 같은 정리 포트를 거쳐야 한다 — 안 거치면 여기서 막히고, FK를 풀면 파일이 고아가 된다.
     */
    @Test
    void deleting_a_draft_curriculum_that_has_a_live_session_succeeds() throws Exception {
        auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        String sectionId = createSection(auth, curriculumId);
        String lessonId = createLesson(auth, sectionId);
        String sessionId = createLiveSession(auth, lessonId);
        UUID assetId = seedRecording(UUID.fromString(lessonId), UUID.fromString(sessionId));
        seedChatMessage(UUID.fromString(lessonId), UUID.fromString(sessionId), currentUserId(auth));
        when(recordingStorage.deletePrefix(anyString(), anyString())).thenReturn(2L);

        write(delete("/api/instructor/curriculums/" + curriculumId), auth, null)
                .andExpect(status().isNoContent());
        createdCurricula.remove(curriculumId);

        assertThat(videoAssetRepository.findById(assetId))
                .as("커리큘럼을 지우면 그 아래 녹화 자산도 남지 않는다").isEmpty();
        verify(recordingStorage).deletePrefix(anyString(), eq("sessions/" + sessionId));
    }

    @Test
    void deleting_a_lesson_without_a_recording_still_works() throws Exception {
        auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        String sectionId = createSection(auth, curriculumId);
        String lessonId = createLesson(auth, sectionId);

        write(delete("/api/instructor/lessons/" + lessonId), auth, null)
                .andExpect(status().isNoContent());
    }

    private void seedChatMessage(UUID lessonId, UUID sessionId, UUID senderId) {
        ChatMessage message = new ChatMessage();
        message.setLiveSessionId(sessionId);
        message.setLessonId(lessonId);
        message.setUserId(senderId);
        message.setAnonymous(false);
        message.setSenderName("테스터");
        message.setSessionMs(1_000L);
        message.setText("삭제 계약 검증용 메시지");
        message.setQuestion(false);
        message.setClientMessageId(UUID.randomUUID().toString());
        chatMessageRepository.saveAndFlush(message);
    }

    private UUID currentUserId(Cookie[] cookies) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/auth/me").cookie(cookies))
                .andExpect(status().isOk()).andReturn();
        return UUID.fromString(json(result).get("userId").asString());
    }

    private UUID seedRecording(UUID lessonId, UUID sessionId) {
        VideoAsset asset = new VideoAsset();
        asset.setLessonId(lessonId);
        asset.setLiveSessionId(sessionId);
        asset.setStatus(VideoAssetStatus.READY);
        asset.setReplayStatus(ReplayStatus.DRAFT);
        asset.setCreatedAt(OffsetDateTime.now());
        return videoAssetRepository.saveAndFlush(asset).getId();
    }

    // --- 요청 헬퍼 (다른 계약 테스트와 같은 형태) ---

    private static org.springframework.test.web.servlet.request.RequestPostProcessor csrf() {
        return org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf();
    }

    private org.springframework.test.web.servlet.ResultActions write(
            MockHttpServletRequestBuilder builder, Cookie[] cookies, String body) throws Exception {
        // MockMvc는 빈 쿠키 배열을 거부한다 — 로그인 전 요청(signup/login)은 쿠키 없이 보낸다.
        MockHttpServletRequestBuilder request = (cookies == null || cookies.length == 0)
                ? builder.with(csrf())
                : builder.cookie(cookies).with(csrf());
        if (body != null) {
            request = request.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(request);
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "del-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), new Cookie[0], """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        MvcResult login = write(post("/api/auth/login"), new Cookie[0], """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn();
        return login.getResponse().getCookies();
    }

    private String createCurriculum(Cookie[] cookies) throws Exception {
        MvcResult result = write(post("/api/instructor/curriculums"), cookies, """
                {"title":"삭제 검증 커리큘럼","summary":"s","description":"d"}
                """).andExpect(status().isCreated()).andReturn();
        String id = json(result).get("curriculumId").asString();
        createdCurricula.add(id);
        return id;
    }

    private String createSection(Cookie[] cookies, String curriculumId) throws Exception {
        MvcResult result = write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), cookies, """
                {"title":"섹션"}
                """).andExpect(status().isCreated()).andReturn();
        return json(result).get("sectionId").asString();
    }

    private String createLesson(Cookie[] cookies, String sectionId) throws Exception {
        MvcResult result = write(post("/api/instructor/sections/" + sectionId + "/lessons"), cookies, """
                {"title":"녹화된 강의"}
                """).andExpect(status().isCreated()).andReturn();
        return json(result).get("lessonId").asString();
    }

    private String createLiveSession(Cookie[] cookies, String lessonId) throws Exception {
        MvcResult result = write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), cookies,
                com.liveclass.support.TestSchedules.futureScheduledAtBody())
                .andExpect(status().isCreated()).andReturn();
        return json(result).get("sessionId").asString();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
