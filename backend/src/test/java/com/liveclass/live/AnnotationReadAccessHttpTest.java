package com.liveclass.live;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.liveclass.live.api.LiveKitServerAccess;
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

    /** op는 실재하는 세션에만 매달린다(FK). 그래서 랜덤 UUID가 아니라 실제 세션을 만든다. */
    private UUID newSession() {
        UUID instructorId = UUID.randomUUID();
        UUID curriculumId = UUID.randomUUID();
        UUID sectionId = UUID.randomUUID();
        UUID lessonId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();

        jdbc.update("insert into core.app_user (id, email, password_hash, display_name, role, status) "
                        + "values (?, ?, 'x', '강사', 'INSTRUCTOR', 'ACTIVE')",
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
