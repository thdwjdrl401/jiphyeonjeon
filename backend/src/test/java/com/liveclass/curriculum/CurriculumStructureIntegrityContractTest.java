package com.liveclass.curriculum;

import com.liveclass.asset.service.AssetStorage;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.BeforeEach;
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

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 커리큘럼 상세가 <b>무엇을 보여주는가</b>와, 게시된 커리큘럼이 <b>빈 상태가 되지 않는가</b>.
 *
 * <p>둘 다 "게시된 것은 수강생에게 그대로 보인다"는 같은 뿌리다. 하나는 커리큘럼 공통 자료라고
 * 말해 놓고 강의 자료까지 섞어 보여 준 것이고, 다른 하나는 게시 조건을 통과한 뒤 그 조건을 다시
 * 깨뜨릴 수 있었던 것이다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class CurriculumStructureIntegrityContractTest {

    private static final String PPTX_TYPE =
            "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AssetStorage storage;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @BeforeEach
    void stubStorage() {
        when(storage.presignUpload(anyString(), anyString(), anyLong(), any(Duration.class)))
                .thenReturn(new AssetStorage.PresignedUpload(
                        "http://fake-minio/upload", OffsetDateTime.now().plusMinutes(10)));
        when(storage.presignDownload(anyString(), any(Duration.class)))
                .thenReturn("http://fake-minio/download");
        when(storage.head(anyString()))
                .thenReturn(Optional.of(new AssetStorage.StoredObject(1_048_576L, PPTX_TYPE)));
    }

    // ---- 자료 범위 ----

    @Test
    void curriculum_detail_shows_only_curriculum_wide_materials() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(instructor);
        String sectionId = createSection(instructor, curriculumId);
        String lessonId = createLesson(instructor, sectionId);

        attachCurriculumMaterial(instructor, curriculumId, "커리큘럼공통.pptx");
        attachLessonMaterial(instructor, lessonId, "강의전용.pptx");

        /*
         * 화면이 "전체 강의에서 공통으로 사용하는 자료입니다"라고 말하는 목록이다. 강의 자료가 섞이면
         * 어느 강의 것인지 알 수 없는 목록이 되고, 응답에는 구분할 필드도 없다.
         */
        mockMvc.perform(get("/api/curriculums/" + curriculumId).cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.materials.length()").value(1))
                .andExpect(jsonPath("$.materials[0].fileName").value("커리큘럼공통.pptx"));
    }

    @Test
    void lesson_detail_still_shows_its_own_material() throws Exception {
        // 강의 자료가 사라진 것이 아니다 — 제자리(레슨 상세)에서 보인다.
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(instructor);
        String lessonId = createLesson(instructor, createSection(instructor, curriculumId));
        attachLessonMaterial(instructor, lessonId, "강의전용.pptx");

        mockMvc.perform(get("/api/instructor/lessons/" + lessonId).cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.materials.length()").value(1))
                .andExpect(jsonPath("$.materials[0].fileName").value("강의전용.pptx"));
    }

    // ---- 게시 뒤 구조 무결성 ----

    @Test
    void the_last_lesson_of_a_published_curriculum_cannot_be_deleted() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(instructor);
        String lessonId = createLesson(instructor, createSection(instructor, curriculumId));
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), instructor, null)
                .andExpect(status().isOk());

        // 지울 수 있으면 목차가 빈 커리큘럼이 카탈로그에 그대로 남는다 — 게시 조건을 우회한 것과 같다.
        write(delete("/api/instructor/lessons/" + lessonId), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("PUBLISHED_STRUCTURE_REQUIRED"));

        mockMvc.perform(get("/api/curriculums/" + curriculumId).cookie(instructor))
                .andExpect(jsonPath("$.outline[0].lessons.length()").value(1));
    }

    @Test
    void the_last_section_of_a_published_curriculum_cannot_be_deleted() throws Exception {
        // 강의를 지우는 길을 막으면 섹션을 지우는 길이 남는다 — 결과가 같으므로 함께 막는다.
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(instructor);
        String keptSectionId = createSection(instructor, curriculumId);
        createLesson(instructor, keptSectionId);
        String emptySectionId = createSection(instructor, curriculumId);
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), instructor, null)
                .andExpect(status().isOk());

        // 빈 섹션은 지울 수 있다 — 지워도 강의가 남는다.
        write(delete("/api/instructor/sections/" + emptySectionId), instructor, null)
                .andExpect(status().isNoContent());
        // 마지막 섹션은 못 지운다.
        write(delete("/api/instructor/sections/" + keptSectionId), instructor, null)
                .andExpect(status().isConflict());
    }

    @Test
    void another_lesson_makes_the_deletion_allowed_again() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(instructor);
        String sectionId = createSection(instructor, curriculumId);
        String first = createLesson(instructor, sectionId);
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), instructor, null)
                .andExpect(status().isOk());

        // 막는 것은 "마지막 하나"뿐이다. 대신할 강의가 있으면 지울 수 있어야 한다.
        createLesson(instructor, sectionId);
        write(delete("/api/instructor/lessons/" + first), instructor, null)
                .andExpect(status().isNoContent());
    }

    @Test
    void a_draft_curriculum_can_still_be_emptied() throws Exception {
        // 초안은 아무에게도 보이지 않는다. 비워도 되고, 다시 게시할 때 조건을 확인한다.
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(instructor);
        String sectionId = createSection(instructor, curriculumId);
        String lessonId = createLesson(instructor, sectionId);

        write(delete("/api/instructor/lessons/" + lessonId), instructor, null)
                .andExpect(status().isNoContent());
        write(delete("/api/instructor/sections/" + sectionId), instructor, null)
                .andExpect(status().isNoContent());
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), instructor, null)
                .andExpect(status().isConflict());
    }

    // ---- 헬퍼 ----

    private String createCurriculum(Cookie[] auth) throws Exception {
        return json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"구조 무결성 테스트\"}")
                .andExpect(status().isCreated()).andReturn()).get("curriculumId").asString();
    }

    private String createSection(Cookie[] auth, String curriculumId) throws Exception {
        return json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth,
                "{\"title\":\"섹션\"}").andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
    }

    private String createLesson(Cookie[] auth, String sectionId) throws Exception {
        return json(write(post("/api/instructor/sections/" + sectionId + "/lessons"), auth,
                "{\"title\":\"강의\"}").andExpect(status().isCreated()).andReturn()).get("lessonId").asString();
    }

    private void attachCurriculumMaterial(Cookie[] auth, String curriculumId, String fileName) throws Exception {
        write(post("/api/instructor/curriculums/" + curriculumId + "/materials"), auth,
                "{\"assetId\":\"%s\"}".formatted(uploadedMaterialAsset(auth, fileName)))
                .andExpect(status().isCreated());
    }

    private void attachLessonMaterial(Cookie[] auth, String lessonId, String fileName) throws Exception {
        write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth,
                "{\"assetId\":\"%s\"}".formatted(uploadedMaterialAsset(auth, fileName)))
                .andExpect(status().isCreated());
    }

    private String uploadedMaterialAsset(Cookie[] auth, String fileName) throws Exception {
        String assetId = json(write(post("/api/assets/upload-requests"), auth, """
                {"kind":"MATERIAL","fileName":"%s","contentType":"%s","fileSize":1048576}
                """.formatted(fileName, PPTX_TYPE)).andExpect(status().isOk()).andReturn())
                .get("assetId").asString();
        write(post("/api/assets/" + assetId + "/complete"), auth, null).andExpect(status().isOk());
        return assetId;
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
        String email = "structure-integrity-" + UUID.randomUUID() + "@liveclass.test";
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
