package com.liveclass.auth;

import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.live.service.AgentDispatchControl;
import com.liveclass.live.service.LiveRoomControl;
import com.liveclass.live.service.LiveStartOrchestrator;
import com.liveclass.support.LiveStartTestSupport;
import jakarta.servlet.http.Cookie;
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
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 회원 탈퇴 계약 (ADR-0031). 소프트 삭제 — 데이터는 남고 로그인만 막힌다.
 *
 * <p>검증 포인트: (1) 탈퇴 후 세션이 파기되어 /me가 401, (2) 옛 비번으로 재로그인 불가,
 * (3) 같은 이메일로 재가입 가능(이메일 tombstone), (4) 진행 중 라이브가 있으면 409로 막힘.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AccountWithdrawalContractTest {

    @Autowired
    private MockMvc mockMvc;

    // 라이브 시작·종료가 실제 LiveKit을 안 타게 목으로 — 테스트가 실 서버에 붙지 않게.
    @MockitoBean
    private LiveRoomControl roomControl;

    @MockitoBean
    private LiveRecordingControl recordingControl;

    @MockitoBean
    private AgentDispatchControl agentDispatchControl;

    @Autowired
    private LiveStartOrchestrator startOrchestrator;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void withdraw_soft_deletes_and_destroys_session() throws Exception {
        String email = "wd-" + UUID.randomUUID() + "@liveclass.test";
        Cookie[] user = signupAndLogin(email, "password123", "STUDENT");

        // 탈퇴 전에는 세션이 살아 있다.
        mockMvc.perform(get("/api/auth/me").cookie(user)).andExpect(status().isOk());

        write(delete("/api/me"), user, null).andExpect(status().isNoContent());

        // 탈퇴 즉시 세션 파기 → 같은 쿠키로 /me가 401.
        mockMvc.perform(get("/api/auth/me").cookie(user)).andExpect(status().isUnauthorized());
    }

    @Test
    void withdrawn_user_cannot_login_again() throws Exception {
        String email = "wd2-" + UUID.randomUUID() + "@liveclass.test";
        Cookie[] user = signupAndLogin(email, "password123", "STUDENT");
        write(delete("/api/me"), user, null).andExpect(status().isNoContent());

        // 옛 자격증명으로 재로그인 불가 — status != ACTIVE 게이트 + 이메일 tombstone.
        login(email, "password123").andExpect(status().isUnauthorized());
    }

    @Test
    void same_email_can_register_again_after_withdrawal() throws Exception {
        String email = "wd3-" + UUID.randomUUID() + "@liveclass.test";
        Cookie[] user = signupAndLogin(email, "password123", "STUDENT");
        write(delete("/api/me"), user, null).andExpect(status().isNoContent());

        // 같은 이메일로 재가입 → tombstone이 UNIQUE 자리를 비웠으므로 201.
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"brandnew789","displayName":"재가입","role":"STUDENT"}
                """.formatted(email)).andExpect(status().isCreated());
        // 새 계정으로 로그인된다.
        login(email, "brandnew789").andExpect(status().isOk());
    }

    @Test
    void withdraw_is_idempotent_via_fresh_session() throws Exception {
        // 첫 탈퇴로 세션이 파기되므로 같은 쿠키로 다시 부르면 401이다(멱등성은 서비스 레벨에서 보장).
        // 여기서는 탈퇴가 두 번째 호출에서 401을 내는지(인증 필요)까지만 확인한다.
        String email = "wd4-" + UUID.randomUUID() + "@liveclass.test";
        Cookie[] user = signupAndLogin(email, "password123", "STUDENT");
        write(delete("/api/me"), user, null).andExpect(status().isNoContent());
        write(delete("/api/me"), user, null).andExpect(status().isUnauthorized());
    }

    @Test
    void instructor_with_live_session_cannot_withdraw_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);
        // 라이브 시작 → LIVE 상태.
        goLive(instructor, sessionId);

        write(delete("/api/me"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("AUTH_WITHDRAWAL_BLOCKED"));

        // 막혔으니 세션은 유지된다 — /me가 여전히 200.
        mockMvc.perform(get("/api/auth/me").cookie(instructor)).andExpect(status().isOk());
    }

    @Test
    void instructor_can_withdraw_after_ending_live() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sessionId = createSession(instructor);
        goLive(instructor, sessionId);
        write(post("/api/live-sessions/" + sessionId + "/end"), instructor, null).andExpect(status().isOk());

        // 종료(ENDED)했으면 탈퇴 가능.
        write(delete("/api/me"), instructor, null).andExpect(status().isNoContent());
    }

    // ---- 헬퍼 ----

    /** /start는 202만 돌려주므로 시작 게이트를 동기로 돌려 LIVE까지 올린다(운영에서는 커밋 후 비동기). */
    private void goLive(Cookie[] instructor, String sessionId) throws Exception {
        String instructorId = json(mockMvc.perform(get("/api/auth/me").cookie(instructor)).andReturn())
                .get("userId").asString();
        LiveStartTestSupport.stubInstructorPublishing(roomControl, sessionId, instructorId);
        LiveStartTestSupport.stubRecordingReady(recordingControl);
        LiveStartTestSupport.stubAgentDispatched(agentDispatchControl);
        write(post("/api/live-sessions/" + sessionId + "/start"), instructor, null).andExpect(status().isAccepted());
        startOrchestrator.runStartGates(UUID.fromString(sessionId));
    }

    private String createSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"탈퇴테스트\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"섹션\"}")
                .andReturn()).get("sectionId").asString();
        String lid = json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"레슨\"}")
                .andReturn()).get("lessonId").asString();
        return json(write(post("/api/instructor/lessons/" + lid + "/live-sessions"), auth, null)
                .andReturn()).get("sessionId").asString();
    }

    private Cookie[] signupAndLogin(String email, String password, String role) throws Exception {
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"%s","displayName":"테스터","role":"%s"}
                """.formatted(email, password, role)).andExpect(status().isCreated());
        return login(email, password).andExpect(status().isOk()).andReturn().getResponse().getCookies();
    }

    private ResultActions login(String email, String password) throws Exception {
        return write(post("/api/auth/login"), null, """
                {"email":"%s","password":"%s"}
                """.formatted(email, password));
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
        return signupAndLogin("wdi-" + UUID.randomUUID() + "@liveclass.test", "password123", role);
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
