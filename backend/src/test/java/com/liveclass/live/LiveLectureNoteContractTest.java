package com.liveclass.live;

import com.liveclass.live.service.LiveLectureNoteService;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 강의 노트 read model 계약(CONTRACT §3-4a).
 *
 * <p>지키려는 것은 <b>조회가 늘 "현재 전체"를 주고, 뒤로 가지 않는다</b>는 것이다. 화면이 조각을
 * 이어 붙이지 않으려면 서버가 한 번만 이어 붙여야 하고, 재전송·순서 역전으로 옛 노트가 도착해도
 * 최신 노트를 덮으면 안 된다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LiveLectureNoteContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private LiveLectureNoteService noteService;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void empty_session_returns_an_empty_note_not_404() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);

        // "노트가 아직 없다"는 오류가 아니다. 화면이 빈 상태를 그리면 된다.
        mockMvc.perform(get("/api/live-sessions/" + ids[1] + "/notes").cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.topics").value("[]"))
                .andExpect(jsonPath("$.markdown").value(""))
                .andExpect(jsonPath("$.coveredThroughSequence").value(0))
                .andExpect(jsonPath("$.status").value("CAPTURING"));
    }

    @Test
    void read_returns_the_whole_note() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);
        noteService.replace(UUID.fromString(ids[1]), UUID.fromString(ids[0]), 21,
                "[{\"topicId\":\"topic-1\",\"title\":\"필터 체인\",\"keyPoints\":[\"순서가 결과를 바꾼다\"]}]",
                "## 필터 체인\n- 순서가 결과를 바꾼다", "CAPTURING");

        mockMvc.perform(get("/api/live-sessions/" + ids[1] + "/notes").cookie(owner))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.coveredThroughSequence").value(21))
                .andExpect(jsonPath("$.topics").value(org.hamcrest.Matchers.containsString("필터 체인")))
                .andExpect(jsonPath("$.markdown").value(org.hamcrest.Matchers.containsString("## 필터 체인")));
    }

    @Test
    void a_late_older_update_does_not_overwrite_the_newer_note() {
        UUID session = UUID.randomUUID();
        UUID lesson = UUID.randomUUID();
        noteService.replace(session, lesson, 21, "[\"new\"]", "새 노트", "CAPTURING");

        // 재전송·순서 역전으로 옛 노트가 뒤늦게 도착하는 경우.
        assertThat(noteService.replace(session, lesson, 5, "[\"old\"]", "옛 노트", "CAPTURING")).isEmpty();
        assertThat(noteService.find(session).markdown()).isEqualTo("새 노트");

        // 같은 진행도의 재전송도 무시한다 — 재전송이 안전해야 한다(멱등).
        assertThat(noteService.replace(session, lesson, 21, "[\"dup\"]", "중복", "CAPTURING")).isEmpty();
        assertThat(noteService.find(session).markdown()).isEqualTo("새 노트");

        assertThat(noteService.replace(session, lesson, 22, "[\"newer\"]", "더 새 노트", "COMPLETED")).isPresent();
        assertThat(noteService.find(session).markdown()).isEqualTo("더 새 노트");
    }

    @Test
    void the_first_update_is_applied_even_at_sequence_zero() {
        UUID session = UUID.randomUUID();
        // 첫 노트가 sequence 0으로 와도 반영돼야 한다 — 초기값 비교에서 삼켜지면 첫 노트가 사라진다.
        assertThat(noteService.replace(session, UUID.randomUUID(), 0, "[\"first\"]", "첫 노트", "CAPTURING"))
                .isPresent();
        assertThat(noteService.find(session).markdown()).isEqualTo("첫 노트");
    }

    @Test
    void an_outsider_cannot_read_the_notes() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String[] ids = createLessonAndSession(owner);

        // 노트는 자막에서 파생된 것이라 자막과 같은 게이트여야 한다.
        Cookie[] outsider = loginAs("STUDENT");
        mockMvc.perform(get("/api/live-sessions/" + ids[1] + "/notes").cookie(outsider))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_FORBIDDEN"));
    }

    @Test
    void unknown_session_returns_404() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        mockMvc.perform(get("/api/live-sessions/" + UUID.randomUUID() + "/notes").cookie(owner))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("LIVE_SESSION_NOT_FOUND"));
    }

    // ---- 헬퍼 ----

    /** @return {lessonId, sessionId} */
    private String[] createLessonAndSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"노트 테스트\"}")
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
        String email = "note-" + UUID.randomUUID() + "@liveclass.test";
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
