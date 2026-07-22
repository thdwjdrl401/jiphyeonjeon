package com.liveclass.curriculum;

import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.EnrollmentType;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.video.domain.ReplayStatus;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 카탈로그가 "지금 할 수 있는 일"을 실제 서버 동작과 어긋나지 않게 답하는지 검증한다.
 *
 * <p>여기서 잡으려는 실패는 하나다 — <b>화면이 거짓말하는 것</b>. 신청 창구가 닫혔는데 신청 버튼이
 * 켜지거나, 녹화가 있는데 "녹화 없음"이라고 답하는 경우다. 그래서 정책 판정은 실제 신청 API의
 * 응답과 짝지어 확인한다(같은 조건에서 GET이 숨긴 행동은 POST도 거부해야 한다).
 *
 * <p>다시보기 쪽은 저장된 녹화를 카탈로그가 어떻게 읽는지만 본다. 녹화가 만들어지는 경로 자체는
 * REQUIRES_NEW 트랜잭션이라 여기서 태울 수 없고, {@code RecordingLifecycleTest}가 커밋된 상태로 검증한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class CatalogPolicyAndReplayContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private CurriculumRepository curriculumRepository;

    @Autowired
    private VideoAssetRepository videoAssetRepository;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    // ---- 수강 신청 정책 ----

    @Test
    void open_window_is_exposed_and_offers_enroll() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        setEnrollmentWindow(cid, OffsetDateTime.now().minusDays(1), OffsetDateTime.now().plusDays(7));
        Cookie[] student = loginAs("STUDENT");

        write(get("/api/curriculums/" + cid), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enrollmentPolicy.status").value("OPEN"))
                .andExpect(jsonPath("$.enrollmentPolicy.opensAt").exists())
                .andExpect(jsonPath("$.enrollmentPolicy.closesAt").exists())
                .andExpect(jsonPath("$.viewerContext.allowedActions[0]").value("ENROLL"));
    }

    @Test
    void before_window_opens_there_is_no_enroll_action_and_apply_is_rejected() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        setEnrollmentWindow(cid, OffsetDateTime.now().plusDays(3), null);
        Cookie[] student = loginAs("STUDENT");

        write(get("/api/curriculums/" + cid), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enrollmentPolicy.status").value("NOT_OPEN"))
                .andExpect(jsonPath("$.viewerContext.relationship").value("UNENROLLED_STUDENT"))
                .andExpect(jsonPath("$.viewerContext.allowedActions").isEmpty());

        // 화면 판정과 실제 API가 같은 답을 해야 한다 — 버튼을 숨겼으면 신청도 막혀야 한다.
        write(post("/api/curriculums/" + cid + "/enrollments"), student, null)
                .andExpect(status().isConflict());
    }

    @Test
    void after_window_closes_there_is_no_enroll_action_and_apply_is_rejected() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        setEnrollmentWindow(cid, OffsetDateTime.now().minusDays(10), OffsetDateTime.now().minusDays(1));
        Cookie[] student = loginAs("STUDENT");

        write(get("/api/curriculums/" + cid), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enrollmentPolicy.status").value("CLOSED"))
                .andExpect(jsonPath("$.viewerContext.allowedActions").isEmpty());

        write(post("/api/curriculums/" + cid + "/enrollments"), student, null)
                .andExpect(status().isConflict());
    }

    @Test
    void invitation_only_has_no_enroll_action_and_apply_is_rejected() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        setEnrollmentType(cid, EnrollmentType.INVITATION_ONLY);
        Cookie[] student = loginAs("STUDENT");

        write(get("/api/curriculums/" + cid), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.enrollmentPolicy.type").value("INVITATION_ONLY"))
                .andExpect(jsonPath("$.enrollmentPolicy.status").value("UNAVAILABLE"))
                .andExpect(jsonPath("$.viewerContext.allowedActions").isEmpty());

        write(post("/api/curriculums/" + cid + "/enrollments"), student, null)
                .andExpect(status().isConflict());
    }

    // ---- 다시보기 상태 ----

    @Test
    void lesson_without_recording_reports_not_ready() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        publishLesson(instructor, cid, "녹화 없는 강의");

        write(get("/api/curriculums/" + cid), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outline[0].lessons[0].replayStatus").value("NOT_READY"))
                .andExpect(jsonPath("$.outline[0].lessons[0].durationMs").doesNotExist());
    }

    @Test
    void recorded_lesson_reports_its_replay_status() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = publishLesson(instructor, cid, "녹화된 강의");
        seedRecording(instructor, lessonId, ReplayStatus.DRAFT);

        // 녹화가 잡히면 더 이상 "녹화 없음"이 아니다. 게시 검수 흐름이 없어 DRAFT에 머문다
        // (녹화 시작이 DRAFT를 세팅하는 것은 RecordingLifecycleTest가 실제 경로로 검증한다).
        write(get("/api/curriculums/" + cid), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outline[0].lessons[0].replayStatus").value("DRAFT"))
                // 재생 길이는 녹화 완료 webhook이 채우는 값이라 이 시점엔 아직 없다.
                .andExpect(jsonPath("$.outline[0].lessons[0].durationMs").doesNotExist());
    }

    @Test
    void published_replay_sends_the_lesson_to_vod() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = publishLesson(instructor, cid, "게시된 녹화");
        seedRecording(instructor, lessonId, ReplayStatus.PUBLISHED);

        // 라이브가 끝난 뒤 게시된 녹화가 있으면 강의를 열었을 때 다시보기로 간다.
        write(get("/api/curriculums/" + cid), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outline[0].lessons[0].replayStatus").value("PUBLISHED"))
                .andExpect(jsonPath("$.outline[0].lessons[0].access.destination").value("VOD"));
    }

    // ---- 헬퍼 ----

    /**
     * 이 강의의 라이브 세션을 만들고 그 녹화본을 원하는 상태로 심는다.
     * 실제 녹화 시작은 REQUIRES_NEW 트랜잭션이라 이 트랜잭션의 미커밋 세션을 볼 수 없어, 여기서는
     * 저장된 녹화를 카탈로그가 어떻게 읽는지만 확인한다(녹화 생성 경로는 RecordingLifecycleTest).
     * 라이브 세션은 종료 상태로 둬야 라이브 목적지가 다시보기를 가리지 않는다.
     */
    private void seedRecording(Cookie[] instructor, String lessonId, ReplayStatus replayStatus) throws Exception {
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), instructor,
                "{\"scheduledAt\":\"2026-08-01T10:00:00+09:00\"}")
                .andExpect(status().isCreated()).andReturn()).get("sessionId").asString();
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isOk());
        write(post("/api/live-sessions/" + sessionId + "/end"), instructor, null).andExpect(status().isOk());

        VideoAsset asset = new VideoAsset();
        asset.setLiveSessionId(UUID.fromString(sessionId));
        asset.setLessonId(UUID.fromString(lessonId));
        asset.setStatus(VideoAssetStatus.READY);
        asset.setReplayStatus(replayStatus);
        asset.setBucket("recordings");
        videoAssetRepository.saveAndFlush(asset);
    }

    private void setEnrollmentWindow(String curriculumId, OffsetDateTime opensAt, OffsetDateTime closesAt) {
        Curriculum c = curriculumRepository.findById(UUID.fromString(curriculumId)).orElseThrow();
        c.setEnrollmentOpensAt(opensAt);
        c.setEnrollmentClosesAt(closesAt);
        curriculumRepository.saveAndFlush(c);
    }

    private void setEnrollmentType(String curriculumId, EnrollmentType type) {
        Curriculum c = curriculumRepository.findById(UUID.fromString(curriculumId)).orElseThrow();
        c.setEnrollmentType(type);
        curriculumRepository.saveAndFlush(c);
    }

    private String createPublishedCurriculum(Cookie[] instructor) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"정책강좌\"}")
                .andReturn()).get("curriculumId").asString();
        write(post("/api/instructor/curriculums/" + cid + "/publish"), instructor, null).andExpect(status().isOk());
        return cid;
    }

    private String publishLesson(Cookie[] instructor, String curriculumId, String title) throws Exception {
        String sectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), instructor,
                "{\"title\":\"1주차\"}").andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sectionId + "/lessons"), instructor,
                "{\"title\":\"%s\"}".formatted(title)).andReturn()).get("lessonId").asString();
        write(post("/api/instructor/lessons/" + lessonId + "/publish"), instructor, null).andExpect(status().isOk());
        return lessonId;
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
        String email = "pol-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn();
        return login.getResponse().getCookies();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
