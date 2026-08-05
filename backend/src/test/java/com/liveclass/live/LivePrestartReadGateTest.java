package com.liveclass.live;

import jakarta.persistence.EntityManager;
import jakarta.persistence.PersistenceContext;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
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
 * 시작하지 않은 강의의 <b>내용</b>은 수강생에게 주지 않는다(ADR-0084).
 *
 * <p>자막·강의 노트·채팅 기록·AI 기록은 모두 강의가 시작된 뒤에 생긴다. 시작 전에 물으면 빈 값이
 * 돌아왔는데, 그러면 "아직 없다"와 "정말 하나도 없었다"가 같은 응답이 된다 — 화면은 기다리라고 말하는데
 * 서버는 다 줬다고 답하는 셈이었다.
 *
 * <p>여기서 못박는 것은 <b>막지 말아야 할 것</b>이기도 하다. 세션 조회는 시작 전에도 열려 있어야 한다 —
 * 기다리는 화면이 그것으로 상태를 읽고, 막으면 기다리는 사람이 영원히 기다린다. 소유 강사도 상태와
 * 무관하게 통과해야 한다(자기 판서 복원 경로가 이 조회다).
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LivePrestartReadGateTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    @PersistenceContext
    private EntityManager entityManager;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    /** 시작 전에 잠기는 내용 조회들. 하나만 검사하면 나머지가 조용히 열려 있어도 통과한다. */
    private static final List<String> CONTENT_PATHS =
            List.of("/captions", "/notes", "/messages", "/ai/answers", "/annotation");

    @Test
    void 수강생은_시작하지_않은_강의의_내용을_읽지_못한다() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        Cookie[] student = enrolledStudent(instructor, ids[2]);

        for (String path : CONTENT_PATHS) {
            mockMvc.perform(get("/api/live-sessions/" + ids[1] + path).cookie(student))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.code").value("LIVE_SESSION_STATE_CONFLICT"));
        }
    }

    /**
     * <b>세션 조회는 막지 않는다.</b> 시작을 기다리는 화면이 이걸로 상태를 읽고, 시작 신호를 받으면
     * 다시 읽어 재생으로 넘어간다 — 여기를 잠그면 기다리는 사람이 빠져나갈 길이 없어진다.
     */
    @Test
    void 시작_전에도_세션_자체는_조회된다() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        Cookie[] student = enrolledStudent(instructor, ids[2]);

        mockMvc.perform(get("/api/live-sessions/" + ids[1]).cookie(student))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSessionStatus").value("SCHEDULED"));
    }

    /**
     * 소유 강사는 상태와 무관하다. 감출 것이 없고, 무엇보다 <b>새로고침 뒤 자기 판서를 되찾는 길</b>이
     * 이 조회다 — 상태로 막으면 방금 그린 것을 못 되찾는다.
     */
    @Test
    void 소유_강사는_시작_전에도_읽는다() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);

        for (String path : CONTENT_PATHS) {
            mockMvc.perform(get("/api/live-sessions/" + ids[1] + path).cookie(instructor))
                    .andExpect(status().isOk());
        }
    }

    /** 시작하면 같은 조회가 열린다 — 잠금이 상태에 매여 있지, 사람에 매여 있는 것이 아니다. */
    @Test
    void 시작한_뒤에는_수강생도_읽는다() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        Cookie[] student = enrolledStudent(instructor, ids[2]);
        markLive(ids[1]);

        for (String path : CONTENT_PATHS) {
            mockMvc.perform(get("/api/live-sessions/" + ids[1] + path).cookie(student))
                    .andExpect(status().isOk());
        }
    }

    /**
     * 종료된 강의는 계속 읽힌다. 복습이 이 경로를 타므로 "시작한 적 있는가"로 판정해야지 "지금
     * 라이브인가"로 판정하면 안 된다.
     */
    @Test
    void 끝난_강의도_수강생이_읽는다() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String[] ids = createSession(instructor);
        Cookie[] student = enrolledStudent(instructor, ids[2]);
        markStatus(ids[1], "ENDED");

        for (String path : CONTENT_PATHS) {
            mockMvc.perform(get("/api/live-sessions/" + ids[1] + path).cookie(student))
                    .andExpect(status().isOk());
        }
    }

    // ---- 헬퍼 ----

    private void markLive(String sessionId) {
        markStatus(sessionId, "LIVE");
    }

    /**
     * 시작 게이트를 실제로 돌리지 않고 상태만 옮긴다 — 여기서 보려는 것은 게이트가 아니라 조회 인가다.
     *
     * <p>바꾼 뒤 <b>영속성 컨텍스트를 비운다.</b> 이 테스트는 {@code @Transactional}이라 MockMvc 요청까지
     * 같은 컨텍스트를 쓰는데, 세션 엔티티가 이미 올라와 있으면 게이트의 {@code findById}가 캐시된 옛
     * 상태를 돌려준다 — JDBC로 바꾼 값이 보이지 않아 영원히 시작 전으로 판정된다.
     */
    private void markStatus(String sessionId, String status) {
        jdbc.update("update core.live_session set status = ?, started_at = now(), "
                + "clock_origin_at = now() where id = ?::uuid", status, sessionId);
        entityManager.flush();
        entityManager.clear();
    }

    /** 신청 → 강사 승인까지 끝낸 활성 수강생. 승인 전에는 접근 게이트에서 403이라 잠금을 볼 수 없다. */
    private Cookie[] enrolledStudent(Cookie[] instructor, String curriculumId) throws Exception {
        Cookie[] student = loginAs("STUDENT");
        String enrollmentId = json(write(post("/api/curriculums/" + curriculumId + "/enrollments"), student, null)
                .andReturn()).get("enrollmentId").asString();
        write(post("/api/instructor/curriculums/" + curriculumId + "/enrollments/" + enrollmentId + "/approve"),
                instructor, null).andExpect(status().isOk());
        return student;
    }

    /** @return {lessonId, sessionId, curriculumId} */
    private String[] createSession(Cookie[] auth) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"시작 전 조회\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), auth, "{\"title\":\"섹션\"}")
                .andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sid + "/lessons"), auth, "{\"title\":\"레슨\"}")
                .andReturn()).get("lessonId").asString();
        // 수강 신청은 게시된 커리큘럼에만 할 수 있다(ADR-0006). 섹션·강의를 만든 뒤에 게시한다.
        write(post("/api/instructor/curriculums/" + cid + "/publish"), auth, null);
        // 예정 시각을 준다 — 없으면 DRAFT로 생긴다. 시작을 기다리는 화면이 보는 상태는 SCHEDULED다.
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), auth,
                "{\"scheduledAt\":\"2099-01-01T10:00:00+09:00\"}")
                .andReturn()).get("sessionId").asString();
        return new String[]{lessonId, sessionId, cid};
    }

    private org.springframework.test.web.servlet.ResultActions write(
            MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body) throws Exception {
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
        String email = "prestart-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        return write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn().getResponse().getCookies();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
