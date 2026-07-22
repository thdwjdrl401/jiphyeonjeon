package com.liveclass.curriculum;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 회귀 테스트: baseVersion 충돌(409) 시 <b>이미 flush된 순서 변경이 실제로 롤백되는지</b>를 확인한다.
 *
 * <p>reorder는 "순서를 다 적용한 뒤 마지막에 structure_version을 CAS"하는 흐름이라, 충돌 시점엔
 * 새 order_index(그리고 섹션 간 이동이면 section_id)가 이미 DB로 flush된 상태다. 즉 "아무것도 안 바뀐다"는
 * 보장은 전적으로 <b>트랜잭션 롤백</b>에 달려 있다.
 *
 * <p>그런데 {@code @Transactional} 계약 테스트로는 이걸 증명할 수 없다 — 서비스 트랜잭션이 테스트
 * 트랜잭션에 참여만 하므로 롤백-only 표시만 되고 flush된 값이 그대로 보인다. 그래서 이 테스트만
 * <b>비-@Transactional(실제 커밋 경계)</b>로 두고, 충돌 후 새 요청으로 커밋된 상태를 다시 읽어 검증한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class StructureReorderRollbackVerifyTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void stale_base_version_rolls_back_already_flushed_order_changes() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "롤백 검증");
        String sectionA = createSection(auth, curriculumId, "A");
        String sectionB = createSection(auth, curriculumId, "B");

        int latest = structureVersion(auth, curriculumId);
        assertOrder(auth, curriculumId, sectionA, sectionB);   // 출발 상태: A(0), B(1)

        // 낡은 baseVersion으로 A/B를 뒤집는 요청 → CAS 실패. 이 시점엔 새 order_index가 이미 flush돼 있다.
        write(put(orderUrl(curriculumId)), auth,
                orderBody(latest - 1, sectionEntry(sectionB), sectionEntry(sectionA)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STRUCTURE_VERSION_CONFLICT"));

        // 커밋된 상태를 새 요청으로 다시 읽는다. 롤백이 안 됐다면 여기서 B, A로 뒤집혀 보인다.
        assertOrder(auth, curriculumId, sectionA, sectionB);
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId).cookie(auth))
                .andExpect(jsonPath("$.structureVersion").value(latest));
    }

    // ---- 헬퍼 ----

    /** 커밋된 섹션 순서가 기대대로인지(0-based). */
    private void assertOrder(Cookie[] auth, String curriculumId, String first, String second) throws Exception {
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId + "/sections").cookie(auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].sectionId").value(first))
                .andExpect(jsonPath("$[0].orderIndex").value(0))
                .andExpect(jsonPath("$[1].sectionId").value(second))
                .andExpect(jsonPath("$[1].orderIndex").value(1));
    }

    private String orderUrl(String curriculumId) {
        return "/api/instructor/curriculums/" + curriculumId + "/curriculum/order";
    }

    private String orderBody(int baseVersion, String... sections) {
        return "{\"baseVersion\":" + baseVersion + ",\"sections\":[" + String.join(",", sections) + "]}";
    }

    private String sectionEntry(String sectionId, String... lessonIds) {
        String lessons = Arrays.stream(lessonIds).map(id -> "\"" + id + "\"").collect(Collectors.joining(","));
        return "{\"sectionId\":\"" + sectionId + "\",\"lessonIds\":[" + lessons + "]}";
    }

    private int structureVersion(Cookie[] auth, String curriculumId) throws Exception {
        MvcResult result = mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId).cookie(auth))
                .andExpect(status().isOk())
                .andReturn();
        return json(result).get("structureVersion").asInt();
    }

    private String createCurriculum(Cookie[] auth, String title) throws Exception {
        MvcResult result = write(post("/api/instructor/curriculums"), auth, "{\"title\":\"" + title + "\"}")
                .andExpect(status().isCreated())
                .andReturn();
        return json(result).get("curriculumId").asString();
    }

    private String createSection(Cookie[] auth, String curriculumId, String title) throws Exception {
        MvcResult result = write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth,
                "{\"title\":\"" + title + "\"}")
                .andExpect(status().isCreated())
                .andReturn();
        return json(result).get("sectionId").asString();
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

        builder = builder
                .cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder = builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "rollback-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role))
                .andExpect(status().isCreated());
        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email))
                .andExpect(status().isOk())
                .andReturn();
        return login.getResponse().getCookies();
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
