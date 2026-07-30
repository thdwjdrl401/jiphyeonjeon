package com.liveclass.curriculum;

import jakarta.persistence.EntityManager;
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
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.stream.Collectors;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 구조 순서 원자 저장 계약 검증 (STRUCTURE-01,
 * docs/frontend/api/CURRICULUM_MANAGEMENT.md §7).
 *
 * <p>검증 대상: 200 저장 + structureVersion 증가 + 이후 조회(강사 목록·공개 목차)에 새 순서 반영,
 * 같은 커리큘럼 안 섹션 간 레슨 이동, baseVersion 불일치 409(최신 버전 동봉),
 * 누락·중복·외부 ID 400(아무것도 바뀌지 않음), 비소유자 403.
 *
 * <p>order는 0-based다 — 기존 조회 API(SectionResponse.orderIndex·LessonView.order·
 * OutlineLesson.order)와 같은 규약을 쓴다(문서 예시의 1-based는 내부 일관성을 위해 따르지 않음).
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class StructureReorderContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private EntityManager entityManager;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    // ---- 정상 저장 ----

    @Test
    void reorder_sections_and_lessons_returns_200_and_bumps_version() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "순서 저장");
        String sectionA = createSection(auth, curriculumId, "A");
        String sectionB = createSection(auth, curriculumId, "B");
        String a1 = createLesson(auth, sectionA, "a1");
        String a2 = createLesson(auth, sectionA, "a2");
        String b1 = createLesson(auth, sectionB, "b1");

        int baseVersion = structureVersion(auth, curriculumId);

        // B를 앞으로, A의 레슨은 뒤집는다.
        write(put(orderUrl(curriculumId)), auth,
                orderBody(baseVersion, sectionEntry(sectionB, b1), sectionEntry(sectionA, a2, a1)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.structureVersion").value(baseVersion + 1))
                .andExpect(jsonPath("$.sections[0].sectionId").value(sectionB))
                .andExpect(jsonPath("$.sections[0].order").value(0))
                .andExpect(jsonPath("$.sections[0].lessons[0].lessonId").value(b1))
                .andExpect(jsonPath("$.sections[0].lessons[0].order").value(0))
                .andExpect(jsonPath("$.sections[1].sectionId").value(sectionA))
                .andExpect(jsonPath("$.sections[1].order").value(1))
                .andExpect(jsonPath("$.sections[1].lessons[0].lessonId").value(a2))
                .andExpect(jsonPath("$.sections[1].lessons[1].lessonId").value(a1));

        // 저장된 값을 DB에서 다시 읽어 확인한다(1차 캐시가 아니라).
        syncWithDatabase();
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId + "/sections").cookie(auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].sectionId").value(sectionB))
                .andExpect(jsonPath("$[0].orderIndex").value(0))
                .andExpect(jsonPath("$[1].sectionId").value(sectionA))
                .andExpect(jsonPath("$[1].orderIndex").value(1));

        mockMvc.perform(get("/api/instructor/sections/" + sectionA + "/lessons").cookie(auth))
                .andExpect(jsonPath("$[0].lessonId").value(a2))
                .andExpect(jsonPath("$[0].order").value(0))
                .andExpect(jsonPath("$[1].lessonId").value(a1))
                .andExpect(jsonPath("$[1].order").value(1));

        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId).cookie(auth))
                .andExpect(jsonPath("$.structureVersion").value(baseVersion + 1));
    }

    @Test
    void reorder_is_reflected_in_public_outline() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "공개 목차 순서");
        String sectionA = createSection(auth, curriculumId, "A");
        String sectionB = createSection(auth, curriculumId, "B");
        String a1 = createLesson(auth, sectionA, "a1");
        String b1 = createLesson(auth, sectionB, "b1");
        addLesson(auth, a1);
        addLesson(auth, b1);
        // 게시 선행 조건(ADR-0006): 섹션·강의가 각각 1개 이상 있어야 발행된다.
        String seedSectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth,
                "{\"title\":\"게시용 섹션\"}").andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
        String seedLessonId = json(write(post("/api/instructor/sections/" + seedSectionId + "/lessons"), auth,
                "{\"title\":\"게시용 강의\"}").andExpect(status().isCreated()).andReturn()).get("lessonId").asString();
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), auth, null)
                .andExpect(status().isOk());
        // 발행 조건만 채우려고 만든 것이라 지운다 — 이 테스트가 세는 강의·목차 인덱스를 원래대로 둔다.
        write(delete("/api/instructor/lessons/" + seedLessonId), auth, null)
                .andExpect(status().isNoContent());
        write(delete("/api/instructor/sections/" + seedSectionId), auth, null)
                .andExpect(status().isNoContent());

        syncWithDatabase();
        mockMvc.perform(get("/api/curriculums/" + curriculumId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outline[0].sectionId").value(sectionA));

        int baseVersion = structureVersion(auth, curriculumId);
        write(put(orderUrl(curriculumId)), auth,
                orderBody(baseVersion, sectionEntry(sectionB, b1), sectionEntry(sectionA, a1)))
                .andExpect(status().isOk());

        syncWithDatabase();
        mockMvc.perform(get("/api/curriculums/" + curriculumId))
                .andExpect(jsonPath("$.outline[0].sectionId").value(sectionB))
                .andExpect(jsonPath("$.outline[0].order").value(0))
                .andExpect(jsonPath("$.outline[1].sectionId").value(sectionA))
                .andExpect(jsonPath("$.outline[1].order").value(1));
    }

    /** 같은 커리큘럼 안이라면 레슨을 다른 섹션으로 옮길 수 있다(DDL 주석 규칙). */
    @Test
    void lesson_moves_to_another_section_of_same_curriculum() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "레슨 이동");
        String sectionA = createSection(auth, curriculumId, "A");
        String sectionB = createSection(auth, curriculumId, "B");
        String a1 = createLesson(auth, sectionA, "a1");
        String a2 = createLesson(auth, sectionA, "a2");

        int baseVersion = structureVersion(auth, curriculumId);
        write(put(orderUrl(curriculumId)), auth,
                orderBody(baseVersion, sectionEntry(sectionA, a1), sectionEntry(sectionB, a2)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.sections[1].lessons[0].lessonId").value(a2));

        syncWithDatabase();
        mockMvc.perform(get("/api/instructor/lessons/" + a2).cookie(auth))
                .andExpect(jsonPath("$.sectionId").value(sectionB))
                .andExpect(jsonPath("$.order").value(0));
        mockMvc.perform(get("/api/instructor/sections/" + sectionA + "/lessons").cookie(auth))
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].lessonId").value(a1));
    }

    /** 섹션이 하나도 없는 커리큘럼은 빈 배열이 유일한 "정확한 순열"이다. */
    @Test
    void empty_structure_can_be_saved() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "빈 구조");

        write(put(orderUrl(curriculumId)), auth, orderBody(0))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.structureVersion").value(1))
                .andExpect(jsonPath("$.sections.length()").value(0));
    }

    // ---- 동시성 ----

    @Test
    void stale_base_version_returns_409_with_latest_version() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "버전 충돌");
        String sectionA = createSection(auth, curriculumId, "A");
        String sectionB = createSection(auth, curriculumId, "B");

        int latest = structureVersion(auth, curriculumId);

        write(put(orderUrl(curriculumId)), auth,
                orderBody(latest - 1, sectionEntry(sectionB), sectionEntry(sectionA)))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("STRUCTURE_VERSION_CONFLICT"))
                .andExpect(jsonPath("$.structureVersion").value(latest));
    }

    // ---- 검증 실패(부분 적용 없음) ----

    @Test
    void missing_section_returns_400_and_changes_nothing() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "섹션 누락");
        String sectionA = createSection(auth, curriculumId, "A");
        String sectionB = createSection(auth, curriculumId, "B");

        int baseVersion = structureVersion(auth, curriculumId);

        // B만 보내면 A가 누락 → 전체 실패.
        write(put(orderUrl(curriculumId)), auth, orderBody(baseVersion, sectionEntry(sectionB)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("STRUCTURE_INVALID"));

        assertUnchanged(auth, curriculumId, sectionA, sectionB, baseVersion);
    }

    @Test
    void duplicated_section_returns_400_and_changes_nothing() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "섹션 중복");
        String sectionA = createSection(auth, curriculumId, "A");
        String sectionB = createSection(auth, curriculumId, "B");

        int baseVersion = structureVersion(auth, curriculumId);

        write(put(orderUrl(curriculumId)), auth,
                orderBody(baseVersion, sectionEntry(sectionA), sectionEntry(sectionA), sectionEntry(sectionB)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("STRUCTURE_INVALID"));

        assertUnchanged(auth, curriculumId, sectionA, sectionB, baseVersion);
    }

    @Test
    void foreign_section_returns_400_and_changes_nothing() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "외부 섹션");
        String sectionA = createSection(auth, curriculumId, "A");
        String sectionB = createSection(auth, curriculumId, "B");

        // 다른 커리큘럼의 섹션은 이 커리큘럼 구조가 아니다.
        String otherCurriculum = createCurriculum(auth, "다른 커리큘럼");
        String foreignSection = createSection(auth, otherCurriculum, "남의 섹션");

        int baseVersion = structureVersion(auth, curriculumId);

        write(put(orderUrl(curriculumId)), auth,
                orderBody(baseVersion, sectionEntry(sectionA), sectionEntry(sectionB), sectionEntry(foreignSection)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("STRUCTURE_INVALID"));

        assertUnchanged(auth, curriculumId, sectionA, sectionB, baseVersion);
    }

    @Test
    void missing_lesson_returns_400_and_changes_nothing() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "레슨 누락");
        String sectionA = createSection(auth, curriculumId, "A");
        String sectionB = createSection(auth, curriculumId, "B");
        String a1 = createLesson(auth, sectionA, "a1");
        createLesson(auth, sectionA, "a2");

        int baseVersion = structureVersion(auth, curriculumId);

        write(put(orderUrl(curriculumId)), auth,
                orderBody(baseVersion, sectionEntry(sectionA, a1), sectionEntry(sectionB)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("STRUCTURE_INVALID"));

        assertUnchanged(auth, curriculumId, sectionA, sectionB, baseVersion);
        mockMvc.perform(get("/api/instructor/sections/" + sectionA + "/lessons").cookie(auth))
                .andExpect(jsonPath("$.length()").value(2));
    }

    @Test
    void duplicated_lesson_returns_400_and_changes_nothing() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "레슨 중복");
        String sectionA = createSection(auth, curriculumId, "A");
        String sectionB = createSection(auth, curriculumId, "B");
        String a1 = createLesson(auth, sectionA, "a1");

        int baseVersion = structureVersion(auth, curriculumId);

        // 같은 레슨을 두 섹션에 걸쳐 넣으면 중복.
        write(put(orderUrl(curriculumId)), auth,
                orderBody(baseVersion, sectionEntry(sectionA, a1), sectionEntry(sectionB, a1)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("STRUCTURE_INVALID"));

        assertUnchanged(auth, curriculumId, sectionA, sectionB, baseVersion);
        mockMvc.perform(get("/api/instructor/lessons/" + a1).cookie(auth))
                .andExpect(jsonPath("$.sectionId").value(sectionA));
    }

    @Test
    void foreign_lesson_returns_400_and_changes_nothing() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "외부 레슨");
        String sectionA = createSection(auth, curriculumId, "A");
        String sectionB = createSection(auth, curriculumId, "B");
        String a1 = createLesson(auth, sectionA, "a1");

        String otherCurriculum = createCurriculum(auth, "다른 커리큘럼");
        String foreignLesson = createLesson(auth, createSection(auth, otherCurriculum, "남의 섹션"), "남의 레슨");

        int baseVersion = structureVersion(auth, curriculumId);

        write(put(orderUrl(curriculumId)), auth,
                orderBody(baseVersion, sectionEntry(sectionA, a1, foreignLesson), sectionEntry(sectionB)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("STRUCTURE_INVALID"));

        assertUnchanged(auth, curriculumId, sectionA, sectionB, baseVersion);
        mockMvc.perform(get("/api/instructor/lessons/" + foreignLesson).cookie(auth))
                .andExpect(jsonPath("$.order").value(0));
    }

    // ---- 인가 ----

    @Test
    void non_owner_instructor_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(owner, "내 것");
        String sectionA = createSection(owner, curriculumId, "A");
        int baseVersion = structureVersion(owner, curriculumId);

        Cookie[] intruder = loginAs("INSTRUCTOR");
        write(put(orderUrl(curriculumId)), intruder, orderBody(baseVersion, sectionEntry(sectionA)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CURRICULUM_FORBIDDEN"));
    }

    @Test
    void unknown_curriculum_returns_404() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        write(put(orderUrl(UUID.randomUUID().toString())), auth, orderBody(0))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CURRICULUM_NOT_FOUND"));
    }

    @Test
    void null_section_element_returns_400_not_500() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth, "널 원소");
        String sectionA = createSection(auth, curriculumId, "A");
        String sectionB = createSection(auth, curriculumId, "B");
        int baseVersion = structureVersion(auth, curriculumId);

        // 배열 원소가 null이면 검증 단계에서 걸러야 한다(예전엔 검증을 통과해 NPE → 500).
        write(put(orderUrl(curriculumId)), auth, orderBody(baseVersion, "null"))
                .andExpect(status().isBadRequest());

        assertUnchanged(auth, curriculumId, sectionA, sectionB, baseVersion);
    }

    // ---- 헬퍼 ----

    /** 실패한 요청이 아무것도 바꾸지 않았는지: 섹션 순서도 structureVersion도 그대로여야 한다. */
    private void assertUnchanged(Cookie[] auth, String curriculumId,
                                 String firstSection, String secondSection, int baseVersion) throws Exception {
        syncWithDatabase();
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId + "/sections").cookie(auth))
                .andExpect(jsonPath("$[0].sectionId").value(firstSection))
                .andExpect(jsonPath("$[0].orderIndex").value(0))
                .andExpect(jsonPath("$[1].sectionId").value(secondSection))
                .andExpect(jsonPath("$[1].orderIndex").value(1));
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId).cookie(auth))
                .andExpect(jsonPath("$.structureVersion").value(baseVersion));
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
        syncWithDatabase();
        MvcResult result = mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId).cookie(auth))
                .andExpect(status().isOk())
                .andReturn();
        return json(result).get("structureVersion").asInt();
    }

    /** 트리거·벌크 UPDATE가 쓴 값을 보려면 flush(반영) + clear(1차 캐시 비움)가 필요하다. */
    private void syncWithDatabase() {
        entityManager.flush();
        entityManager.clear();
    }

    private String createCurriculum(Cookie[] auth, String title) throws Exception {
        MvcResult result = write(post("/api/instructor/curriculums"), auth,
                "{\"title\":\"" + title + "\"}")
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

    private String createLesson(Cookie[] auth, String sectionId, String title) throws Exception {
        MvcResult result = write(post("/api/instructor/sections/" + sectionId + "/lessons"), auth,
                "{\"title\":\"" + title + "\"}")
                .andExpect(status().isCreated())
                .andReturn();
        return json(result).get("lessonId").asString();
    }

    private void addLesson(Cookie[] auth, String lessonId) throws Exception {
    }

    /** 변경 요청: CSRF 핸드셰이크(쿠키+헤더) + 로그인 세션 쿠키를 함께 실어 보낸다. */
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
        String email = "user-" + UUID.randomUUID() + "@liveclass.test";

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
