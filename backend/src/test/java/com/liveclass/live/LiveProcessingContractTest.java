package com.liveclass.live;

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
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 종료 후 처리 현황 계약(CONTRACT §2-2).
 *
 * <p>지키려는 것은 <b>두 상태축이 접히지 않는 것</b>이다. 라이브 세션과 녹화 자산은 따로 움직이며
 * (ADR-0003 §3), 특히 자산이 {@code READY}인 것과 다시보기가 게시된 것은 다른 사실이다. 서버가 이 둘을
 * 하나의 불리언으로 접어 주면 화면이 "재생 가능"과 "수강생에게 공개됨"을 구분할 수 없다.
 *
 * <p>표시 문구를 응답에 넣지 않는 것도 함께 고정한다 — 넣으면 문구 한 줄에 서버 배포가 필요해진다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LiveProcessingContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private VideoAssetRepository videoAssetRepository;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void processing_reports_session_and_asset_as_separate_axes() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);
        seedAsset(ids[0], ids[1], VideoAssetStatus.READY, ReplayStatus.DRAFT, null);

        mockMvc.perform(get("/api/instructor/live-sessions/" + ids[1] + "/processing").cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sessionId").value(ids[1]))
                .andExpect(jsonPath("$.liveSessionStatus").exists())
                .andExpect(jsonPath("$.recordingEnabled").value(true))
                // 기존 미게시 자산처럼 READY + DRAFT도 표현할 수 있어야 두 축이 접히지 않는다.
                .andExpect(jsonPath("$.videoAsset.status").value("READY"))
                .andExpect(jsonPath("$.videoAsset.replayStatus").value("DRAFT"))
                .andExpect(jsonPath("$.videoAsset.failureCode").doesNotExist());
    }

    @Test
    void response_carries_no_display_text() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);
        seedAsset(ids[0], ids[1], VideoAssetStatus.FINALIZING, ReplayStatus.DRAFT, null);

        JsonNode body = json(mockMvc.perform(
                        get("/api/instructor/live-sessions/" + ids[1] + "/processing").cookie(owner))
                .andExpect(status().isOk()).andReturn());

        // 서버는 상태만 준다. 'steps'·'label'·'ready' 같은 화면 표현이 계약에 들어오면
        // 문구 한 줄 고치는 데 서버 배포가 필요해진다.
        org.assertj.core.api.Assertions.assertThat(body.has("steps")).isFalse();
        org.assertj.core.api.Assertions.assertThat(body.has("ready")).isFalse();
        org.assertj.core.api.Assertions.assertThat(body.toString()).doesNotContain("label");
    }

    @Test
    void failed_asset_exposes_failure_code() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);
        seedAsset(ids[0], ids[1], VideoAssetStatus.FAILED, ReplayStatus.DRAFT, "EGRESS_FAILED");

        mockMvc.perform(get("/api/instructor/live-sessions/" + ids[1] + "/processing").cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.videoAsset.status").value("FAILED"))
                // 실패 이유가 없으면 강사는 재시도하면 되는지 영상이 날아갔는지 알 수 없다.
                .andExpect(jsonPath("$.videoAsset.failureCode").value("EGRESS_FAILED"));
    }

    @Test
    void missing_asset_is_null_not_failure() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);   // 자산을 만들지 않는다

        mockMvc.perform(get("/api/instructor/live-sessions/" + ids[1] + "/processing").cookie(owner))
                .andExpect(status().isOk())
                // 녹화가 아직 없다는 것은 실패가 아니다. 그 구분을 화면이 할 수 있어야 한다.
                .andExpect(jsonPath("$.videoAsset").doesNotExist())
                .andExpect(jsonPath("$.recordingEnabled").value(true));
    }

    @Test
    void other_instructor_gets_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);

        Cookie[] intruder = loginAs("INSTRUCTOR");
        mockMvc.perform(get("/api/instructor/live-sessions/" + ids[1] + "/processing").cookie(intruder))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_FORBIDDEN"));
    }

    @Test
    void student_gets_403_by_role_gate() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);

        Cookie[] student = loginAs("STUDENT");
        mockMvc.perform(get("/api/instructor/live-sessions/" + ids[1] + "/processing").cookie(student))
                .andExpect(status().isForbidden());
    }

    @Test
    void unknown_session_returns_404() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        mockMvc.perform(get("/api/instructor/live-sessions/" + UUID.randomUUID() + "/processing").cookie(owner))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_NOT_FOUND"));
    }

    // ---- 헬퍼 ----

    private void seedAsset(String lessonId, String sessionId, VideoAssetStatus status,
                           ReplayStatus replayStatus, String failureCode) {
        VideoAsset asset = new VideoAsset();
        asset.setLiveSessionId(UUID.fromString(sessionId));
        asset.setLessonId(UUID.fromString(lessonId));
        asset.setEgressId("eg_" + UUID.randomUUID());
        asset.setStatus(status);
        asset.setReplayStatus(replayStatus);
        asset.setFailureCode(failureCode);
        asset.setBucket("recordings");
        asset.setHlsManifestKey("sessions/" + sessionId + "/index.m3u8");
        videoAssetRepository.saveAndFlush(asset);
    }

    /** @return {lessonId, sessionId} */
    private String[] createLessonAndSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"처리 현황 테스트\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"섹션\"}")
                .andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"레슨\"}")
                .andReturn()).get("lessonId").asString();
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null)
                .andReturn()).get("sessionId").asString();
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

    private Cookie[] loginAs(String role) throws Exception {
        String email = "proc-" + UUID.randomUUID() + "@liveclass.test";
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
