package com.liveclass.live;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.liveclass.live.api.LiveKitServerAccess;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.Date;
import java.util.Map;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 판서 문서 읽기 — <b>필터 체인을 실제로 지나는</b> 경로(ADR-0055, CONTRACT §3-6d).
 *
 * <p>{@link LiveRoomTokenReadAccessTest}는 토큰 검증기만 본다. 검증기가 옳아도 <b>그 앞</b>에서
 * 막히면 소용이 없다 — 이 엔드포인트를 {@code permitAll}로 열어야 쿠키 없는 Egress가 컨트롤러까지
 * 도달하고, 그렇게 열었다는 이유로 아무나 읽게 되어서도 안 된다. 그 둘은 필터 체인을 실제로 태워야
 * 확인된다.
 *
 * <p>여기서 고정하는 것: {@code permitAll}은 "누구나 읽어도 된다"가 아니라 <b>"인가를 컨트롤러가
 * 한다"</b>는 뜻이고, 그 인가는 <b>읽기에만</b> 열려 있다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AnnotationReadAccessHttpTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private LiveKitServerAccess livekit;

    @Autowired
    private JdbcTemplate jdbc;

    /** 방 이름 규칙은 §3-6d에 적힌 그대로 만든다 — 서비스 상수를 빌려 오면 규칙이 바뀌어도 통과한다. */
    private String tokenFor(UUID sessionId, String secret) {
        return JWT.create()
                .withIssuer(livekit.apiKey())
                .withSubject("egress")
                .withExpiresAt(new Date(System.currentTimeMillis() + 600_000))
                .withClaim("video", Map.of("room", "session-" + sessionId, "roomJoin", true))
                .sign(Algorithm.HMAC256(secret));
    }

    /**
     * 실제 로그인 쿠키를 얻는다. CSRF 토큰을 먼저 받아 실어야 한다(SPA용 쿠키+헤더 에코, ADR-0014).
     */
    private String lastEmail;

    private Cookie[] loginAsInstructor() throws Exception {
        String email = "annot-read-" + java.util.UUID.randomUUID() + "@liveclass.test";
        lastEmail = email;
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"강사","role":"INSTRUCTOR"}
                """.formatted(email)).andExpect(status().isCreated());
        return write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn().getResponse().getCookies();
    }

    /** CSRF 토큰을 붙여 쓰기 요청을 보낸다. */
    private org.springframework.test.web.servlet.ResultActions write(
            org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder builder,
            Cookie[] authCookies, String body) throws Exception {
        var csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        var node = new com.fasterxml.jackson.databind.ObjectMapper()
                .readTree(csrf.getResponse().getContentAsString());
        java.util.List<Cookie> cookies = new java.util.ArrayList<>();
        cookies.add(csrf.getResponse().getCookie("XSRF-TOKEN"));
        if (authCookies != null) cookies.addAll(java.util.List.of(authCookies));
        builder = builder.cookie(cookies.toArray(new Cookie[0]))
                .header(node.get("headerName").asText(), node.get("token").asText());
        if (body != null) builder = builder.contentType("application/json").content(body);
        return mockMvc.perform(builder);
    }

    /** op는 실재하는 세션에만 매달린다(FK). 그래서 랜덤 UUID가 아니라 실제 세션을 만든다. */
    private UUID newSession() {
        return newSession(UUID.randomUUID());
    }

    /** 소유 강사를 지정해 세션을 만든다. 쿠키 경로는 <b>소유자</b>여야 통과한다. */
    private UUID newSession(UUID instructorId) {
        UUID curriculumId = UUID.randomUUID();
        UUID sectionId = UUID.randomUUID();
        UUID lessonId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();

        jdbc.update("insert into core.app_user (id, email, password_hash, display_name, role, status) "
                        + "values (?, ?, 'x', '강사', 'INSTRUCTOR', 'ACTIVE') on conflict (id) do nothing",
                instructorId, "annotation-read-" + instructorId + "@test.local");
        jdbc.update("insert into core.curriculum (id, instructor_id, title) values (?, ?, '판서')",
                curriculumId, instructorId);
        jdbc.update("insert into core.section (id, curriculum_id, title, order_index) values (?, ?, 's', 1)",
                sectionId, curriculumId);
        jdbc.update("insert into core.lesson (id, section_id, title, order_index) values (?, ?, 'l', 1)",
                lessonId, sectionId);
        jdbc.update("insert into core.live_session (id, lesson_id, curriculum_id, instructor_id, status) "
                        + "values (?, ?, ?, ?, 'LIVE')",
                sessionId, lessonId, curriculumId, instructorId);
        return sessionId;
    }

    /**
     * Egress가 쿠키 없이 LiveKit 토큰만으로 문서를 읽는다. 이 길이 막히면 판서 전체 상태가 합성
     * 화면에 닿지 못한다 — 데이터 채널로 미는 길은 64KB 한도에 걸려 이미 닫혔다(실측 74.9KB).
     */
    @Test
    void 방_토큰만_들고_와도_문서를_읽는다() throws Exception {
        UUID sessionId = newSession();

        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/annotation")
                        .header("Authorization", "Bearer " + tokenFor(sessionId, livekit.apiSecret())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nextRevision").exists());
    }

    /**
     * <b>쿠키로 로그인한 강사가 읽는다.</b> 새로고침 복원이 타는 바로 그 경로다 — 여기가 막히면
     * 강사 화면에서만 판서가 사라지고 수강생·녹화에는 그대로 남는다.
     *
     * <p>이 엔드포인트는 Egress를 위해 {@code permitAll}이 되었다. 그 순간 <b>세션 쿠키로도 여전히
     * 읽히는지</b>가 새 검증 대상이 된다 — permitAll은 인가를 컨트롤러로 옮길 뿐이고, 컨트롤러가
     * 인증 주체를 못 알아보면 로그인한 강사가 자기 판서를 못 읽는다.
     */
    @Test
    void 로그인한_강사는_쿠키로_읽는다() throws Exception {
        Cookie[] auth = loginAsInstructor();
        UUID instructorId = UUID.fromString(
                jdbc.queryForObject("select id::text from core.app_user where email = ?", String.class, lastEmail));
        UUID sessionId = newSession(instructorId);

        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/annotation").cookie(auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nextRevision").exists());
    }

    /** 다른 강의의 토큰으로 남의 판서를 읽을 수 있으면 안 된다. */
    @Test
    void 다른_방의_토큰으로는_읽지_못한다() throws Exception {
        UUID sessionId = newSession();

        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/annotation")
                        .header("Authorization", "Bearer " + tokenFor(UUID.randomUUID(), livekit.apiSecret())))
                .andExpect(status().isForbidden());
    }

    /** 우리 시크릿으로 서명되지 않았다면 우리가 발급한 토큰이 아니다. */
    @Test
    void 남의_시크릿으로_서명한_토큰은_읽지_못한다() throws Exception {
        UUID sessionId = newSession();

        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/annotation")
                        .header("Authorization", "Bearer " + tokenFor(sessionId, "someone-elses-secret-someone-elses")))
                .andExpect(status().isForbidden());
    }

    /**
     * {@code permitAll}은 "누구나 읽어도 된다"가 아니라 "인가를 컨트롤러가 한다"는 뜻이다. 아무것도
     * 들고 오지 않으면 막혀야 한다.
     */
    @Test
    void 아무_증명도_없으면_막는다() throws Exception {
        UUID sessionId = newSession();

        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/annotation"))
                .andExpect(status().isForbidden());
    }

    /* ── 판서 표시 상태(ADR-0056) ─────────────────────────────────────────────── */

    /**
     * 표시 상태가 <b>새로고침을 넘어 남는다.</b> 이것이 없으면 강사는 판서가 꺼진 화면을 보는데
     * Egress는 자기 문서를 계속 그려서, <b>수강생에게만 판서가 남는다</b> — 강사 화면에서는
     * 정상으로 보이므로 알아챌 수 없다.
     */
    @Test
    void 판서_표시_상태를_세션에_남긴다() throws Exception {
        Cookie[] auth = loginAsInstructor();
        UUID instructorId = UUID.fromString(
                jdbc.queryForObject("select id::text from core.app_user where email = ?", String.class, lastEmail));
        UUID sessionId = newSession(instructorId);

        // 새 세션은 꺼진 채로 시작한다.
        assertVisible(sessionId, auth, false);

        write(put("/api/live-sessions/" + sessionId + "/annotation/visibility"), auth, "{\"visible\":true}")
                .andExpect(status().isNoContent());
        assertVisible(sessionId, auth, true);

        write(put("/api/live-sessions/" + sessionId + "/annotation/visibility"), auth, "{\"visible\":false}")
                .andExpect(status().isNoContent());
        assertVisible(sessionId, auth, false);
    }

    /** 표시 상태는 <b>소유 강사만</b> 바꾼다. 수강생이 남의 판서를 켜고 끌 수 있으면 안 된다. */
    @Test
    void 표시_상태는_소유_강사만_바꾼다() throws Exception {
        Cookie[] other = loginAsInstructor();
        UUID sessionId = newSession();   // 다른(랜덤) 강사 소유

        write(put("/api/live-sessions/" + sessionId + "/annotation/visibility"), other, "{\"visible\":true}")
                .andExpect(status().isForbidden());
    }

    /**
     * <b>API 표면으로 확인한다.</b> 컬럼을 직접 읽으면 두 가지를 놓친다 — 값이 응답에 실리는지
     * 검증되지 않고, 같은 트랜잭션에서 JPA 변경이 아직 flush되지 않아 raw JDBC로는 보이지도 않는다.
     */
    private void assertVisible(UUID sessionId, Cookie[] auth, boolean expected) throws Exception {
        mockMvc.perform(get("/api/live-sessions/" + sessionId).cookie(auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.annotationVisible").value(expected));
    }

    /* ── 복원 체크포인트(ADR-0057) ────────────────────────────────────────────── */

    /**
     * <b>체크포인트부터 접는다.</b> 이것이 없으면 복원이 세션 시작부터 전부 내려온다 — 실측에서
     * op 233건이 983kB였고, 강의가 길어질수록 무한히 자란다.
     */
    @Test
    void 체크포인트를_저장하면_그_이후_op만_돌려준다() throws Exception {
        Cookie[] auth = loginAsInstructor();
        UUID instructorId = UUID.fromString(
                jdbc.queryForObject("select id::text from core.app_user where email = ?", String.class, lastEmail));
        UUID sessionId = newSession(instructorId);

        // op 다섯 건을 남긴다.
        for (int revision = 1; revision <= 5; revision += 1) {
            write(post("/api/live-sessions/" + sessionId + "/annotation/ops"), auth, """
                    [{"revision":%d,"opType":"upsert","payload":"{\\"elements\\":[]}","occurredAt":"2026-08-01T10:00:00Z"}]
                    """.formatted(revision)).andExpect(status().isAccepted());
        }
        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/annotation").cookie(auth))
                .andExpect(jsonPath("$.ops.length()").value(5))
                .andExpect(jsonPath("$.snapshotPayload").doesNotExist());

        // revision 3까지 반영한 체크포인트를 남기면, 그 뒤 두 건만 내려온다.
        write(put("/api/live-sessions/" + sessionId + "/annotation/snapshot"), auth,
                "{\"revision\":3,\"payload\":\"{\\\"elements\\\":[]}\"}")
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/annotation").cookie(auth))
                .andExpect(jsonPath("$.ops.length()").value(2))
                .andExpect(jsonPath("$.snapshotPayload").exists());
    }

    /**
     * <b>뒤로 가는 체크포인트는 무시한다.</b> 강사가 창을 둘 열면 늦게 온 것이 더 옛 문서일 수 있고,
     * 그것으로 덮으면 복원이 오히려 과거로 돌아간다.
     */
    @Test
    void 더_옛_체크포인트로는_덮지_않는다() throws Exception {
        Cookie[] auth = loginAsInstructor();
        UUID instructorId = UUID.fromString(
                jdbc.queryForObject("select id::text from core.app_user where email = ?", String.class, lastEmail));
        UUID sessionId = newSession(instructorId);

        write(put("/api/live-sessions/" + sessionId + "/annotation/snapshot"), auth,
                "{\"revision\":10,\"payload\":\"{\\\"elements\\\":[],\\\"mark\\\":\\\"new\\\"}\"}")
                .andExpect(status().isNoContent());
        write(put("/api/live-sessions/" + sessionId + "/annotation/snapshot"), auth,
                "{\"revision\":4,\"payload\":\"{\\\"elements\\\":[],\\\"mark\\\":\\\"old\\\"}\"}")
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/live-sessions/" + sessionId + "/annotation").cookie(auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.snapshotPayload").value(org.hamcrest.Matchers.containsString("new")));
    }

    /** 체크포인트도 <b>소유 강사만</b> 쓴다. 남의 판서 복원을 바꿀 수 있으면 안 된다. */
    @Test
    void 체크포인트는_소유_강사만_저장한다() throws Exception {
        Cookie[] other = loginAsInstructor();
        UUID sessionId = newSession();

        write(put("/api/live-sessions/" + sessionId + "/annotation/snapshot"), other,
                "{\"revision\":1,\"payload\":\"{}\"}")
                .andExpect(status().isForbidden());
    }

    /**
     * <b>읽기 전용이다.</b> 방에 들어올 수 있다는 것과 문서를 고칠 수 있다는 것은 다르다 — 쓰기가
     * 열리면 revision 채번의 단일 writer 전제가 깨진다.
     */
    @Test
    void 방_토큰으로는_쓰지_못한다() throws Exception {
        UUID sessionId = newSession();

        mockMvc.perform(post("/api/live-sessions/" + sessionId + "/annotation/ops")
                        .header("Authorization", "Bearer " + tokenFor(sessionId, livekit.apiSecret()))
                        .contentType("application/json")
                        .content("""
                                [{"revision":1,"opType":"upsert","payload":"{}","occurredAt":"2026-07-31T10:00:00Z"}]"""))
                .andExpect(status().is4xxClientError());
    }
}
