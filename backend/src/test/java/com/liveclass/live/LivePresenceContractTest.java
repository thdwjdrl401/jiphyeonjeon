package com.liveclass.live;

import com.liveclass.live.service.LivePresenceRegistry;
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
 * 접속자 수의 <b>초기값</b> 계약(ADR-0060).
 *
 * <p>WebSocket 브로드캐스트만으로는 방금 들어온 본인이 자기 숫자를 받지 못한다 — 구독 인가는 브로커가
 * 구독을 등록하기 전에 지나가기 때문이다. 그래서 세션 조회가 초기값을 준다. 이 응답에서
 * {@code participantCount}가 빠지면 화면은 다시 "언제나 0"으로 돌아간다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LivePresenceContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private LivePresenceRegistry presenceRegistry;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void session_read_carries_the_current_audience_count() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String sessionId = createSession(owner);

        mockMvc.perform(get("/api/live-sessions/" + sessionId).cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participantCount").value(0));

        // 수강생 둘이 강의실을 열었다고 치자(구독 인터셉터가 하는 등록).
        presenceRegistry.join("ws-a", UUID.fromString(sessionId), UUID.randomUUID(), false);
        presenceRegistry.join("ws-b", UUID.fromString(sessionId), UUID.randomUUID(), false);

        mockMvc.perform(get("/api/live-sessions/" + sessionId).cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participantCount").value(2));
    }

    @Test
    void the_instructor_is_not_counted_as_audience() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String sessionId = createSession(owner);

        presenceRegistry.join("ws-teacher", UUID.fromString(sessionId), UUID.randomUUID(), true);

        // 강사 자신이 포함되면 혼자일 때 1이 되어 "몇 명이 듣고 있는가"를 오해하게 만든다.
        mockMvc.perform(get("/api/live-sessions/" + sessionId).cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.participantCount").value(0));
    }

    // ---- 헬퍼 ----

    private String createSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"접속자 테스트\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"섹션\"}")
                .andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"레슨\"}")
                .andReturn()).get("lessonId").asString();
        return json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null)
                .andReturn()).get("sessionId").asString();
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
        String email = "presence-" + UUID.randomUUID() + "@liveclass.test";
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
