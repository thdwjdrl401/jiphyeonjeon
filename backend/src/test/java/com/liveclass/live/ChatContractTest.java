package com.liveclass.live;

import com.liveclass.live.service.LiveRoomControl;
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
 * 라이브 채팅 저장·복구 계약 검증. 프라이버시(실명·userId 미노출), 멱등, 강사/학생 가명, 복구 조회.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class ChatContractTest {

    @Autowired
    private MockMvc mockMvc;

    // 세션 시작이 방 제어를 안 부르지만, 안전하게 목으로 둔다.
    @MockitoBean
    private LiveRoomControl roomControl;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void student_message_uses_anonymous_alias_and_hides_identity() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createStartedLessonSession(instructor);

        Cookie[] student = loginAs("STUDENT");
        MvcResult res = write(post("/api/lessons/" + lessonId + "/messages"), student, """
                {"clientMessageId":"c-1","text":"질문 있어요","isQuestion":true}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.text").value("질문 있어요"))
                .andExpect(jsonPath("$.isQuestion").value(true))
                .andExpect(jsonPath("$.alias").exists())
                .andReturn();

        String body = res.getResponse().getContentAsString();
        // 프라이버시: 실명·내부 userId·displayName은 응답에 없어야 한다.
        org.assertj.core.api.Assertions.assertThat(body)
                .doesNotContain("userId")
                .doesNotContain("테스터");
        // 학생 가명은 익명 형식.
        org.assertj.core.api.Assertions.assertThat(json(res).get("alias").asString()).startsWith("수강생-");
    }

    @Test
    void instructor_message_shows_display_name_as_alias() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createStartedLessonSession(instructor);

        write(post("/api/lessons/" + lessonId + "/messages"), instructor, """
                {"clientMessageId":"c-i","text":"안녕하세요"}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.alias").value("테스터"));   // 강사는 표시 이름
    }

    @Test
    void list_marks_only_my_messages_as_mine_for_the_requester() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createStartedLessonSession(instructor);
        Cookie[] me = loginAs("STUDENT");
        Cookie[] other = loginAs("STUDENT");

        write(post("/api/lessons/" + lessonId + "/messages"), me, "{\"clientMessageId\":\"m1\",\"text\":\"내가 보냄\"}").andReturn();
        write(post("/api/lessons/" + lessonId + "/messages"), other, "{\"clientMessageId\":\"o1\",\"text\":\"남이 보냄\"}").andReturn();

        // 새로고침/재접속처럼 clientMessageId 로컬 기억 없이 GET만으로도 서버가 세션 기준 mine을 판정한다.
        mockMvc.perform(get("/api/lessons/" + lessonId + "/messages").cookie(me))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].text").value("내가 보냄"))
                .andExpect(jsonPath("$[0].mine").value(true))
                .andExpect(jsonPath("$[1].text").value("남이 보냄"))
                .andExpect(jsonPath("$[1].mine").value(false));

        // 같은 목록을 다른 사람이 조회하면 mine 판정이 뒤바뀐다(뷰어별 계산).
        mockMvc.perform(get("/api/lessons/" + lessonId + "/messages").cookie(other))
                .andExpect(jsonPath("$[0].mine").value(false))
                .andExpect(jsonPath("$[1].mine").value(true));
    }

    @Test
    void resend_with_same_client_message_id_is_idempotent() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createStartedLessonSession(instructor);
        Cookie[] student = loginAs("STUDENT");

        String first = json(write(post("/api/lessons/" + lessonId + "/messages"), student, """
                {"clientMessageId":"dup-1","text":"한번만"}
                """).andReturn()).get("messageId").asString();
        String second = json(write(post("/api/lessons/" + lessonId + "/messages"), student, """
                {"clientMessageId":"dup-1","text":"한번만"}
                """).andReturn()).get("messageId").asString();

        org.assertj.core.api.Assertions.assertThat(second).isEqualTo(first);   // 같은 메시지, 중복 저장 안 됨

        mockMvc.perform(get("/api/lessons/" + lessonId + "/messages").cookie(student))
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void list_recovers_messages_in_order() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createStartedLessonSession(instructor);
        Cookie[] student = loginAs("STUDENT");
        write(post("/api/lessons/" + lessonId + "/messages"), student, "{\"clientMessageId\":\"a\",\"text\":\"첫째\"}").andReturn();
        write(post("/api/lessons/" + lessonId + "/messages"), student, "{\"clientMessageId\":\"b\",\"text\":\"둘째\"}").andReturn();

        mockMvc.perform(get("/api/lessons/" + lessonId + "/messages").cookie(student))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].text").value("첫째"))
                .andExpect(jsonPath("$[1].text").value("둘째"));
    }

    @Test
    void chatting_a_lesson_without_live_session_returns_404() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createLessonWithoutSession(instructor);
        Cookie[] student = loginAs("STUDENT");

        write(post("/api/lessons/" + lessonId + "/messages"), student, "{\"clientMessageId\":\"x\",\"text\":\"hi\"}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_NOT_FOUND"));
    }

    @Test
    void chat_requires_authentication() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createStartedLessonSession(instructor);

        Cookie xsrf = fetchXsrf();
        mockMvc.perform(post("/api/lessons/" + lessonId + "/messages")
                        .cookie(xsrf).header("X-XSRF-TOKEN", xsrfToken)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"clientMessageId\":\"z\",\"text\":\"hi\"}"))
                .andExpect(status().isUnauthorized());
    }

    // ---- 헬퍼 ----

    private String xsrfToken;

    private Cookie fetchXsrf() throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        xsrfToken = json(csrf).get("token").asString();
        return csrf.getResponse().getCookie("XSRF-TOKEN");
    }

    private String createLessonWithoutSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"채팅\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"s\"}")
                .andReturn()).get("sectionId").asString();
        return json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"l\"}")
                .andReturn()).get("lessonId").asString();
    }

    private String createStartedLessonSession(Cookie[] auth) throws Exception {
        String lessonId = createLessonWithoutSession(auth);
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null)
                .andReturn()).get("sessionId").asString();
        write(post("/api/live-sessions/" + sessionId + "/start"), auth, null).andExpect(status().isOk());
        return lessonId;
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
        String email = "chat-" + UUID.randomUUID() + "@liveclass.test";
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
