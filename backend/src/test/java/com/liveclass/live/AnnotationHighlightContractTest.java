package com.liveclass.live;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 강조 판서 캡처 계약(ADR-0074).
 *
 * <p>여기서 고정하는 것은 셋이다.
 *
 * <ul>
 *   <li><b>시각은 서버가 정한다.</b> 클라이언트가 {@code sessionMs}를 보내지 못한다 — 채팅과 같은
 *       규칙이다. 클라이언트 시계를 믿으면 다시보기 앵커가 영상과 어긋나고, 그 어긋남은 나중에
 *       근거를 눌렀을 때만 드러난다.</li>
 *   <li><b>소유 강사만</b>이다. 이 캡처는 영실이 근거로 색인되므로 수강생이 넣을 수 있으면 안 된다.</li>
 *   <li><b>제외는 지우개와 무관하다.</b> 명시적으로 뺀 것만 목록에서 사라진다.</li>
 * </ul>
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AnnotationHighlightContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private JdbcTemplate jdbc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void 강사가_캡처를_남기면_서버가_시각을_붙여_돌려준다() throws Exception {
        Fixture f = fixture();
        UUID assetId = seedUploadedSnapshotAsset(f.instructorId);

        MvcResult created = write(post(highlights(f.sessionId)), f.auth, """
                {"assetId":"%s","interpretedText":"이 부분이 핵심"}
                """.formatted(assetId))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.highlightId").exists())
                .andExpect(jsonPath("$.assetId").value(assetId.toString()))
                .andExpect(jsonPath("$.interpretedText").value("이 부분이 핵심"))
                .andExpect(jsonPath("$.indexStatus").value("PENDING"))
                // 아직 AI에 보내지 않았다. 상태가 PENDING이 아니면 색인 연결 전에 근거로 새어 나간다.
                .andExpect(jsonPath("$.sessionMs").isNumber())
                .andReturn();

        // 라이브 시작 기준 경과 ms다. 시작 시각을 1분 전으로 심었으므로 0보다 커야 한다 —
        // 0이면 clock_origin_at을 안 보고 있다는 뜻이고, 그러면 모든 근거가 영상 맨 앞을 가리킨다.
        long sessionMs = json(created).get("sessionMs").asLong();
        org.assertj.core.api.Assertions.assertThat(sessionMs)
                .as("라이브 시작 기준 경과 ms").isGreaterThan(0L);
    }

    @Test
    void 캡처_목록은_시각순이고_뺀_것은_담지_않는다() throws Exception {
        Fixture f = fixture();
        String first = capture(f, "첫째");
        String second = capture(f, "둘째");

        write(get(highlights(f.sessionId)), f.auth, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(2));

        write(delete(highlights(f.sessionId) + "/" + first), f.auth, null)
                .andExpect(status().isNoContent());

        write(get(highlights(f.sessionId)), f.auth, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].highlightId").value(second));

        // 멱등 — 다시 빼도 성공한다.
        write(delete(highlights(f.sessionId) + "/" + first), f.auth, null)
                .andExpect(status().isNoContent());
    }

    /** 수강생은 캡처를 만들 수도, 볼 수도 없다. 근거로 색인되는 것이라 강사 전용이다. */
    @Test
    void 수강생은_캡처를_만들지도_보지도_못한다() throws Exception {
        Fixture f = fixture();
        Cookie[] student = loginAs("STUDENT");
        UUID assetId = seedUploadedSnapshotAsset(f.instructorId);

        write(post(highlights(f.sessionId)), student, """
                {"assetId":"%s"}""".formatted(assetId))
                .andExpect(status().isForbidden());
        write(get(highlights(f.sessionId)), student, null)
                .andExpect(status().isForbidden());
    }

    /**
     * 남의 에셋·다른 종류·업로드 미완은 붙지 않는다. 여기서 막지 않으면 나중에 AI가 읽으러 갔을 때
     * 빈 객체를 만나고, 그때는 원인을 찾기 어렵다.
     */
    @Test
    void 붙일_수_없는_에셋은_400이다() throws Exception {
        Fixture f = fixture();

        write(post(highlights(f.sessionId)), f.auth, """
                {"assetId":"%s"}""".formatted(UUID.randomUUID()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ANNOTATION_HIGHLIGHT_INVALID"));

        UUID othersAsset = seedUploadedSnapshotAsset(UUID.randomUUID());
        write(post(highlights(f.sessionId)), f.auth, """
                {"assetId":"%s"}""".formatted(othersAsset))
                .andExpect(status().isBadRequest());

        UUID pending = seedAsset(f.instructorId, "ANNOTATION_SNAPSHOT", "PENDING");
        write(post(highlights(f.sessionId)), f.auth, """
                {"assetId":"%s"}""".formatted(pending))
                .andExpect(status().isBadRequest());

        UUID wrongKind = seedAsset(f.instructorId, "THUMBNAIL", "UPLOADED");
        write(post(highlights(f.sessionId)), f.auth, """
                {"assetId":"%s"}""".formatted(wrongKind))
                .andExpect(status().isBadRequest());
    }

    // ---- 헬퍼 ----

    private record Fixture(UUID sessionId, UUID instructorId, Cookie[] auth) {
    }

    private static String highlights(UUID sessionId) {
        return "/api/live-sessions/" + sessionId + "/annotation/highlights";
    }

    private String capture(Fixture f, String text) throws Exception {
        UUID assetId = seedUploadedSnapshotAsset(f.instructorId);
        MvcResult result = write(post(highlights(f.sessionId)), f.auth, """
                {"assetId":"%s","interpretedText":"%s"}""".formatted(assetId, text))
                .andExpect(status().isCreated()).andReturn();
        return json(result).get("highlightId").asString();
    }

    /** 로그인한 강사가 소유한 LIVE 세션. 시작 시각을 1분 전으로 심어 경과 ms가 0이 아니게 한다. */
    private Fixture fixture() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        UUID instructorId = UUID.fromString(json(mockMvc.perform(get("/api/auth/me").cookie(auth))
                .andExpect(status().isOk()).andReturn()).get("userId").asString());

        UUID curriculumId = UUID.randomUUID();
        UUID sectionId = UUID.randomUUID();
        UUID lessonId = UUID.randomUUID();
        UUID sessionId = UUID.randomUUID();
        jdbc.update("insert into core.curriculum (id, instructor_id, title) values (?, ?, '강조')",
                curriculumId, instructorId);
        jdbc.update("insert into core.section (id, curriculum_id, title, order_index) values (?, ?, 's', 1)",
                sectionId, curriculumId);
        jdbc.update("insert into core.lesson (id, section_id, title, order_index) values (?, ?, 'l', 1)",
                lessonId, sectionId);
        jdbc.update("insert into core.live_session (id, lesson_id, curriculum_id, instructor_id, status,"
                        + " clock_origin_at) values (?, ?, ?, ?, 'LIVE', ?)",
                sessionId, lessonId, curriculumId, instructorId,
                OffsetDateTime.now().minusMinutes(1));
        return new Fixture(sessionId, instructorId, auth);
    }

    private UUID seedUploadedSnapshotAsset(UUID ownerId) {
        return seedAsset(ownerId, "ANNOTATION_SNAPSHOT", "UPLOADED");
    }

    /**
     * 에셋 행을 직접 심는다. presigned 업로드는 실제 스토리지를 부르므로 계약 검증에 필요하지 않다 —
     * 여기서 고정하려는 것은 "어떤 에셋을 붙일 수 있는가"이지 업로드 경로가 아니다.
     */
    private UUID seedAsset(UUID ownerId, String kind, String status) {
        UUID assetId = UUID.randomUUID();
        jdbc.update("insert into core.app_user (id, email, password_hash, display_name, role, status) "
                        + "values (?, ?, 'x', '소유자', 'INSTRUCTOR', 'ACTIVE') on conflict (id) do nothing",
                ownerId, "highlight-owner-" + ownerId + "@test.local");
        jdbc.update("insert into core.asset (id, kind, status, uploaded_by, bucket, object_key, content_type,"
                        + " size_bytes, original_filename) values (?, ?, ?, ?, 'liveclass', ?, 'image/png',"
                        + " 1024, 'crop.png')",
                assetId, kind, status, ownerId, "assets/" + assetId + "/crop.png");
        return assetId;
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "highlight-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        return write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn().getResponse().getCookies();
    }

    private ResultActions write(MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body)
            throws Exception {
        MvcResult csrf = mockMvc.perform(get("/api/auth/csrf")).andReturn();
        JsonNode node = jsonMapper.readTree(csrf.getResponse().getContentAsString());
        List<Cookie> cookies = new ArrayList<>();
        cookies.add(csrf.getResponse().getCookie("XSRF-TOKEN"));
        if (authCookies != null) {
            cookies.addAll(List.of(authCookies));
        }
        builder = builder.cookie(cookies.toArray(new Cookie[0]))
                .header(node.get("headerName").asString(), node.get("token").asString());
        if (body != null) {
            builder = builder.contentType("application/json").content(body);
        }
        return mockMvc.perform(builder);
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
