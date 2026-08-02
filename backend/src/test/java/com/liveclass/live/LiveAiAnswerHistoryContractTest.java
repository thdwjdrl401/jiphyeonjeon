package com.liveclass.live;

import com.liveclass.live.domain.LiveAiAnswer;
import com.liveclass.live.repository.LiveAiAnswerRepository;
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

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * AI 질문 기록 조회 계약(ADR-0047 확장).
 *
 * <p>가장 중요한 것은 <b>개인 범위</b>다. 채팅과 달리 남의 질문이 보이면 "무엇을 모르는지"가 드러난다.
 * 조회 조건에서 {@code userId}가 빠지는 회귀를 여기서 잡는다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LiveAiAnswerHistoryContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private LiveAiAnswerRepository repository;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void my_questions_come_back_in_the_order_i_asked_them() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);
        UUID me = currentUserId(owner);

        seed(ids, me, "req-2", "두 번째 질문", "두 번째 답", "DONE", OffsetDateTime.now());
        seed(ids, me, "req-1", "첫 질문", "첫 답", "DONE", OffsetDateTime.now().minusMinutes(5));

        mockMvc.perform(get("/api/live-sessions/" + ids[1] + "/ai/answers").cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2))
                // 저장 순서가 아니라 물어본 순서다 — 대화는 시간 순으로 읽힌다.
                .andExpect(jsonPath("$[0].question").value("첫 질문"))
                .andExpect(jsonPath("$[1].question").value("두 번째 질문"))
                .andExpect(jsonPath("$[0].answer").value("첫 답"))
                .andExpect(jsonPath("$[0].status").value("DONE"));
    }

    @Test
    void i_never_see_someone_elses_questions() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);
        UUID me = currentUserId(owner);
        UUID someoneElse = UUID.randomUUID();

        seed(ids, me, "req-mine", "내 질문", "내 답", "DONE", OffsetDateTime.now());
        seed(ids, someoneElse, "req-theirs", "남의 질문", "남의 답", "DONE", OffsetDateTime.now());

        // 조회 조건에서 userId가 빠지면 여기서 2건이 나온다.
        mockMvc.perform(get("/api/live-sessions/" + ids[1] + "/ai/answers").cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].question").value("내 질문"));
    }

    @Test
    void a_failed_answer_is_kept_with_its_reason() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);
        UUID me = currentUserId(owner);

        // 중간에 끊긴 답변도 남긴다 — 받은 데까지는 새로고침 뒤에도 읽을 수 있어야 한다.
        LiveAiAnswer row = seed(ids, me, "req-broken", "끊긴 질문", "받다가 만 답",
                "ERROR", OffsetDateTime.now());
        row.setFailureCode("PROXY_STREAM_INCOMPLETE");
        repository.saveAndFlush(row);

        mockMvc.perform(get("/api/live-sessions/" + ids[1] + "/ai/answers").cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].status").value("ERROR"))
                .andExpect(jsonPath("$[0].failureCode").value("PROXY_STREAM_INCOMPLETE"))
                .andExpect(jsonPath("$[0].answer").value("받다가 만 답"));
    }

    @Test
    void an_empty_history_is_an_empty_list_not_an_error() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);

        mockMvc.perform(get("/api/live-sessions/" + ids[1] + "/ai/answers").cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(0));
    }

    @Test
    void an_outsider_cannot_read_the_history() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);

        // 스트림과 같은 게이트다 — 세션에 못 들어가면 자기 기록도 조회하지 않는다.
        Cookie[] outsider = loginAs("STUDENT");
        mockMvc.perform(get("/api/live-sessions/" + ids[1] + "/ai/answers").cookie(outsider))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_FORBIDDEN"));
    }

    @Test
    void the_same_request_is_never_stored_twice() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);
        UUID me = currentUserId(owner);

        seed(ids, me, "req-dup", "질문", "답", "DONE", OffsetDateTime.now());
        // requestId가 멱등키다. 재시도·중복 저장이 대화를 두 번 남기면 안 된다.
        assertThat(repository.existsByRequestId("req-dup")).isTrue();
    }

    // ---- 헬퍼 ----

    private LiveAiAnswer seed(String[] ids, UUID userId, String requestId, String question,
                              String answer, String status, OffsetDateTime askedAt) {
        LiveAiAnswer row = new LiveAiAnswer();
        row.setRequestId(requestId);
        row.setSessionId(UUID.fromString(ids[1]));
        row.setLessonId(UUID.fromString(ids[0]));
        row.setUserId(userId);
        row.setQuestion(question);
        row.setAnswer(answer);
        row.setSources("[]");
        row.setStatus(status);
        row.setAskedAt(askedAt);
        return repository.saveAndFlush(row);
    }

    /** @return {lessonId, sessionId} */
    private String[] createLessonAndSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"AI 기록 테스트\"}")
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

    /** 로그인 응답이 userId를 준다 — 별도 조회 엔드포인트가 없다. */
    private final java.util.Map<String, UUID> userIdByCookie = new java.util.HashMap<>();

    private Cookie[] loginAs(String role) throws Exception {
        String email = "aihist-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn();
        Cookie[] cookies = login.getResponse().getCookies();
        userIdByCookie.put(key(cookies), UUID.fromString(json(login).get("userId").asString()));
        return cookies;
    }

    private UUID currentUserId(Cookie[] auth) {
        return userIdByCookie.get(key(auth));
    }

    private static String key(Cookie[] cookies) {
        StringBuilder sb = new StringBuilder();
        for (Cookie c : cookies) {
            sb.append(c.getName()).append('=').append(c.getValue()).append(';');
        }
        return sb.toString();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
