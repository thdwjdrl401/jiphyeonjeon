package com.liveclass.video;

import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.service.EgressControl;
import jakarta.servlet.http.Cookie;
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

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 회귀 테스트: 실제 이벤트 경로(start 커밋 → AFTER_COMMIT 리스너 → RecordingService)로 video_asset이
 * 진짜로 커밋되는지 확인한다. mock·@Transactional 테스트는 startRecording을 직접 호출해 자체 tx로 통과하므로
 * 이 경로의 트랜잭션 전파 버그(REQUIRED가 AFTER_COMMIT에서 커밋 안 됨)를 못 잡는다 — 그래서 비-@Transactional
 * 실커밋 테스트로 검증한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class RecordingCommitPathVerifyTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private VideoAssetRepository videoAssetRepository;
    @MockitoBean private EgressControl egressControl;
    @MockitoBean private LiveRoomControl roomControl;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void video_asset_actually_persists_via_after_commit_path() throws Exception {
        when(egressControl.startHlsRecording(any(), any())).thenReturn("eg_verify");

        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        UUID sessionId = UUID.fromString(ids[1]);

        // 실제 커밋 → AFTER_COMMIT 리스너가 RecordingService.startRecording 호출
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isOk());

        // 새 조회(커밋된 데이터만 보임)로 video_asset이 정말 남았는지
        boolean present = videoAssetRepository.findByLiveSessionId(sessionId).isPresent();
        System.out.println("RESULT_VIDEO_ASSET_PERSISTED=" + present);

        // 정리: 남은 행 삭제(비트랜잭션 테스트라 롤백 안 됨)
        videoAssetRepository.findByLiveSessionId(sessionId).ifPresent(videoAssetRepository::delete);

        if (!present) {
            throw new AssertionError("BUG CONFIRMED: video_asset이 AFTER_COMMIT 경로에서 커밋되지 않음");
        }
    }

    private String[] createSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"v\"}").andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"s\"}").andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"l\"}").andReturn()).get("lessonId").asString();
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null).andReturn()).get("sessionId").asString();
        return new String[]{lessonId, sessionId};
    }

    private org.springframework.test.web.servlet.ResultActions write(
            MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body) throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode csrfBody = json(csrf);
        List<Cookie> cookies = new ArrayList<>();
        cookies.add(csrf.getResponse().getCookie("XSRF-TOKEN"));
        if (authCookies != null) cookies.addAll(List.of(authCookies));
        builder = builder.cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) builder = builder.contentType(MediaType.APPLICATION_JSON).content(body);
        return mockMvc.perform(builder);
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "recverify-" + UUID.randomUUID() + "@liveclass.test";
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
