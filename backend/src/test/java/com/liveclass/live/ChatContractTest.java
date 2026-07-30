package com.liveclass.live;

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
 * 라이브 채팅 저장·복구 계약 검증. 프라이버시(userId 미노출), 멱등, 익명 선택(ADR-0050), 복구 조회.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class ChatContractTest {

    @Autowired
    private MockMvc mockMvc;

    // 시작 요청이 실제 LiveKit에 방을 만들거나 참가자를 조회하지 않게 목으로 둔다.
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
    void student_message_with_anonymous_true_uses_alias_and_hides_identity() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);
        String sessionId = created[0];

        Cookie[] student = loginAs("STUDENT");
        enrollActive(created[1], student, instructor);   // 활성 수강생이어야 채팅 가능
        MvcResult res = write(post("/api/live-sessions/" + sessionId + "/messages"), student, """
                {"clientMessageId":"c-1","text":"질문 있어요","isQuestion":true,"anonymous":true}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.text").value("질문 있어요"))
                .andExpect(jsonPath("$.isQuestion").value(true))
                .andExpect(jsonPath("$.alias").exists())
                .andExpect(jsonPath("$.mine").value(true))   // 익명이어도 보낸 본인에겐 내 메시지다
                .andReturn();

        String body = res.getResponse().getContentAsString();
        // 프라이버시: 내부 userId는 없고, 익명을 켰으니 표시 이름도 새어 나가지 않는다.
        org.assertj.core.api.Assertions.assertThat(body)
                .doesNotContain("userId")
                .doesNotContain("테스터");
        // 익명을 켠 학생만 가명 형식.
        org.assertj.core.api.Assertions.assertThat(json(res).get("alias").asString()).startsWith("수강생-");
    }

    /**
     * 익명은 기본값이 아니라 발신자 선택이다(ADR-0050). 체크하지 않은 전송은 본인이 지정한 표시 이름으로
     * 나가고, 그래도 내부 userId는 응답에 없다.
     */
    @Test
    void student_message_without_anonymous_shows_own_display_name() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);
        String sessionId = created[0];

        Cookie[] student = loginAs("STUDENT");
        enrollActive(created[1], student, instructor);

        // 필드 생략 = 체크 안 함 → 표시 이름.
        MvcResult omitted = write(post("/api/live-sessions/" + sessionId + "/messages"), student, """
                {"clientMessageId":"c-plain","text":"이름 보여도 괜찮아요"}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.alias").value("테스터"))
                .andReturn();
        org.assertj.core.api.Assertions.assertThat(omitted.getResponse().getContentAsString())
                .doesNotContain("userId");

        // 명시적 false도 같은 뜻이어야 한다(체크박스를 켰다 끈 전송).
        write(post("/api/live-sessions/" + sessionId + "/messages"), student, """
                {"clientMessageId":"c-plain-2","text":"두 번째","anonymous":false}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.alias").value("테스터"));
    }

    @Test
    void instructor_message_shows_display_name_as_alias() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);
        String sessionId = created[0];

        write(post("/api/live-sessions/" + sessionId + "/messages"), instructor, """
                {"clientMessageId":"c-i","text":"안녕하세요"}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.alias").value("테스터"));   // 강사는 표시 이름
    }

    /** 강사는 요청으로 익명을 켜도 익명이 되지 않는다 — 수업 진행자 신원은 드러나야 한다(ADR-0050). */
    @Test
    void instructor_cannot_be_anonymous_even_when_requested() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);
        String sessionId = created[0];

        write(post("/api/live-sessions/" + sessionId + "/messages"), instructor, """
                {"clientMessageId":"c-i-anon","text":"익명으로 보내볼까","anonymous":true}
                """)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.alias").value("테스터"));
    }

    @Test
    void list_marks_only_my_messages_as_mine_for_the_requester() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);
        String sessionId = created[0];
        Cookie[] me = loginAs("STUDENT");
        Cookie[] other = loginAs("STUDENT");
        enrollActive(created[1], me, instructor);
        enrollActive(created[1], other, instructor);

        // 내 메시지는 익명으로 보낸다 — mine은 alias가 아니라 저장된 발신자로 판정되므로 익명이어도 정확해야 한다.
        write(post("/api/live-sessions/" + sessionId + "/messages"), me, "{\"clientMessageId\":\"m1\",\"text\":\"내가 보냄\",\"anonymous\":true}").andReturn();
        write(post("/api/live-sessions/" + sessionId + "/messages"), other, "{\"clientMessageId\":\"o1\",\"text\":\"남이 보냄\"}").andReturn();

        // 새로고침/재접속처럼 clientMessageId 로컬 기억 없이 GET만으로도 서버가 세션 기준 mine을 판정한다.
        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/messages").cookie(me))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].text").value("내가 보냄"))
                .andExpect(jsonPath("$[0].mine").value(true))
                .andExpect(jsonPath("$[0].alias").value(org.hamcrest.Matchers.startsWith("수강생-")))
                .andExpect(jsonPath("$[1].text").value("남이 보냄"))
                .andExpect(jsonPath("$[1].mine").value(false))
                .andExpect(jsonPath("$[1].alias").value("테스터"));   // 익명 미선택 → 본인이 지정한 표시 이름

        // 같은 목록을 다른 사람이 조회하면 mine 판정이 뒤바뀐다(뷰어별 계산).
        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/messages").cookie(other))
                .andExpect(jsonPath("$[0].mine").value(false))
                .andExpect(jsonPath("$[1].mine").value(true));
    }

    @Test
    void resend_with_same_client_message_id_is_idempotent() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);
        String sessionId = created[0];
        Cookie[] student = loginAs("STUDENT");
        enrollActive(created[1], student, instructor);

        String first = json(write(post("/api/live-sessions/" + sessionId + "/messages"), student, """
                {"clientMessageId":"dup-1","text":"한번만"}
                """).andReturn()).get("messageId").asString();
        String second = json(write(post("/api/live-sessions/" + sessionId + "/messages"), student, """
                {"clientMessageId":"dup-1","text":"한번만"}
                """).andReturn()).get("messageId").asString();

        org.assertj.core.api.Assertions.assertThat(second).isEqualTo(first);   // 같은 메시지, 중복 저장 안 됨

        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/messages").cookie(student))
                .andExpect(jsonPath("$.length()").value(1));
    }

    @Test
    void list_recovers_messages_in_order() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);
        String sessionId = created[0];
        Cookie[] student = loginAs("STUDENT");
        enrollActive(created[1], student, instructor);
        write(post("/api/live-sessions/" + sessionId + "/messages"), student, "{\"clientMessageId\":\"a\",\"text\":\"첫째\"}").andReturn();
        write(post("/api/live-sessions/" + sessionId + "/messages"), student, "{\"clientMessageId\":\"b\",\"text\":\"둘째\"}").andReturn();

        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/messages").cookie(student))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                .andExpect(jsonPath("$[0].text").value("첫째"))
                .andExpect(jsonPath("$[1].text").value("둘째"));
    }

    @Test
    void chatting_a_nonexistent_session_returns_404() throws Exception {
        Cookie[] student = loginAs("STUDENT");
        String missingSession = UUID.randomUUID().toString();

        write(post("/api/live-sessions/" + missingSession + "/messages"), student, "{\"clientMessageId\":\"x\",\"text\":\"hi\"}")
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_NOT_FOUND"));
    }

    @Test
    void chat_requires_authentication() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);
        String sessionId = created[0];

        Cookie xsrf = fetchXsrf();
        mockMvc.perform(post("/api/live-sessions/" + sessionId + "/messages")
                        .cookie(xsrf).header("X-XSRF-TOKEN", xsrfToken)
                        .contentType(MediaType.APPLICATION_JSON).content("{\"clientMessageId\":\"z\",\"text\":\"hi\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void listing_messages_without_enrollment_is_forbidden() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] created = createStartedSession(instructor);
        String sessionId = created[0];

        Cookie[] student = loginAs("STUDENT");   // 수강 신청 안 함 — 조회도 막혀야 한다(전송과 동일 게이트).
        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/messages").cookie(student))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_FORBIDDEN"));
    }

    @Test
    void chat_text_over_limit_returns_400() throws Exception {
        Cookie[] student = loginAs("STUDENT");
        String anySession = UUID.randomUUID().toString();
        String tooLong = "가".repeat(2001);   // @Size(max=2000) 초과 — 컨트롤러 진입 전 검증에서 걸린다

        write(post("/api/live-sessions/" + anySession + "/messages"), student,
                "{\"clientMessageId\":\"c-long\",\"text\":\"" + tooLong + "\"}")
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_FAILED"))
                .andExpect(jsonPath("$.fieldErrors[?(@.field=='text')].code").value("INVALID_LENGTH"));
    }

    // ---- 헬퍼 ----

    private String xsrfToken;

    private Cookie fetchXsrf() throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        xsrfToken = json(csrf).get("token").asString();
        return csrf.getResponse().getCookie("XSRF-TOKEN");
    }

    /** 세션 시작 + 커리큘럼 발행. {sessionId, curriculumId} 반환(수강 등록에 curriculumId 필요). */
    private String[] createStartedSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"채팅\"}")
                .andReturn()).get("curriculumId").asString();
        // 게시 선행 조건(ADR-0006): 섹션·강의가 각각 1개 이상 있어야 발행된다.
        String seedSectionId = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth,
                "{\"title\":\"게시용 섹션\"}").andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
        write(post("/api/instructor/sections/" + seedSectionId + "/lessons"), auth,
                "{\"title\":\"게시용 강의\"}").andExpect(status().isCreated());
        write(post("/api/instructor/curriculums/" + cid + "/publish"), auth, null).andExpect(status().isOk());
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"s\"}")
                .andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"l\"}")
                .andReturn()).get("lessonId").asString();
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth, null)
                .andReturn()).get("sessionId").asString();
        // /start는 202만 돌려주므로 게이트를 동기로 돌려 LIVE까지 올린다(운영에서는 커밋 후 비동기).
        String instructorId = json(mockMvc.perform(get("/api/auth/me").cookie(auth)).andReturn())
                .get("userId").asString();
        LiveStartTestSupport.stubInstructorPublishing(roomControl, sessionId, instructorId);
        LiveStartTestSupport.stubRecordingReady(recordingControl);
        LiveStartTestSupport.stubAgentDispatched(agentDispatchControl);
        write(post("/api/live-sessions/" + sessionId + "/start"), auth, null).andExpect(status().isAccepted());
        startOrchestrator.runStartGates(UUID.fromString(sessionId));
        return new String[]{sessionId, cid};
    }

    /** 학생을 이 커리큘럼의 ACTIVE 수강생으로: 신청 → 강사 승인(채팅 게이트 통과용). */
    private void enrollActive(String cid, Cookie[] student, Cookie[] instructor) throws Exception {
        String eid = json(write(post("/api/curriculums/" + cid + "/enrollments"), student, null)
                .andReturn()).get("enrollmentId").asString();
        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve"), instructor, null)
                .andExpect(status().isOk());
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
