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
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 커리큘럼-레벨 자료 연결 계약 검증(ADR-0042). 레슨 자료(LessonMaterialContractTest)와 대칭이며 같은
 * material_asset 테이블을 커리큘럼 스코프로 재사용한다. 소유권(비소유 강사 403)·에셋 유효성·중복(409)·
 * 응답 필드명(camelCase)·관리 GET/공개 상세의 materials 노출·다운로드 302를 본다. 스토리지는 모킹한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class CurriculumMaterialContractTest {

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

    @Test
    void attach_material_returns_201_with_contract_fields() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        String assetId = uploadedMaterialAsset(auth);

        write(post("/api/instructor/curriculums/" + curriculumId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.materialId").exists())
                .andExpect(jsonPath("$.assetId").value(assetId))
                .andExpect(jsonPath("$.fileName").value("deck.pptx"))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.material_id").doesNotExist());
    }

    @Test
    void attach_material_by_non_owner_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(owner);

        Cookie[] intruder = loginAs("INSTRUCTOR");
        String assetId = uploadedMaterialAsset(intruder);

        write(post("/api/instructor/curriculums/" + curriculumId + "/materials"), intruder, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isForbidden());
    }

    @Test
    void attach_material_to_unknown_curriculum_returns_404() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String assetId = uploadedMaterialAsset(auth);

        write(post("/api/instructor/curriculums/" + UUID.randomUUID() + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isNotFound());
    }

    @Test
    void duplicate_attach_returns_409() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        String assetId = uploadedMaterialAsset(auth);

        write(post("/api/instructor/curriculums/" + curriculumId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isCreated());

        write(post("/api/instructor/curriculums/" + curriculumId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("MATERIAL_ALREADY_ATTACHED"));
    }

    @Test
    void attach_non_material_asset_returns_400() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        when(storage.head(anyString()))
                .thenReturn(Optional.of(new AssetStorage.StoredObject(2048L, "image/png")));
        String thumbnailAssetId = uploadedThumbnailAsset(auth);

        write(post("/api/instructor/curriculums/" + curriculumId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(thumbnailAssetId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MATERIAL_INVALID"));
    }

    @Test
    void instructor_curriculum_get_includes_attached_materials() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        String assetId = uploadedMaterialAsset(auth);

        write(post("/api/instructor/curriculums/" + curriculumId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isCreated());

        // 관리 GET(강사 수정 폼의 데이터 소스)은 저장된 커리큘럼 자료를 줘야 새로고침 후에도 유지된다.
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId).cookie(auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.materials.length()").value(1))
                .andExpect(jsonPath("$.materials[0].fileName").value("deck.pptx"))
                .andExpect(jsonPath("$.materials[0].materialId").exists())
                .andExpect(jsonPath("$.materials[0].embeddingStatus").value("READY"));
    }

    @Test
    void detach_material_removes_it_and_is_idempotent() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        String assetId = uploadedMaterialAsset(auth);
        String materialId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId)).andExpect(status().isCreated()).andReturn()).get("materialId").asString();

        write(delete("/api/instructor/curriculums/" + curriculumId + "/materials/" + materialId), auth, null)
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId).cookie(auth))
                .andExpect(jsonPath("$.materials.length()").value(0));

        // 멱등 — 이미 삭제된 걸 또 삭제해도 204.
        write(delete("/api/instructor/curriculums/" + curriculumId + "/materials/" + materialId), auth, null)
                .andExpect(status().isNoContent());
    }

    @Test
    void download_material_redirects_to_presigned_url() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        String assetId = uploadedMaterialAsset(auth);
        String materialId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId)).andExpect(status().isCreated()).andReturn()).get("materialId").asString();

        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId + "/materials/" + materialId + "/download").cookie(auth))
                .andExpect(status().isFound())
                .andExpect(header().exists("Location"));
    }

    @Test
    void download_unknown_material_returns_404() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(auth);
        mockMvc.perform(get("/api/instructor/curriculums/" + curriculumId + "/materials/" + UUID.randomUUID() + "/download").cookie(auth))
                .andExpect(status().isNotFound());
    }

    @Test
    void curriculum_detail_hides_materials_from_guest_but_shows_owner() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(instructor);
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), instructor, null).andExpect(status().isOk());

        String assetId = uploadedMaterialAsset(instructor);
        write(post("/api/instructor/curriculums/" + curriculumId + "/materials"), instructor, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isCreated());

        // 게스트(비로그인) — 커리큘럼 자료가 있어도 목록은 비어야 한다(레슨 자료와 같은 가시성 게이트).
        mockMvc.perform(get("/api/curriculums/" + curriculumId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.materials.length()").value(0));

        // 소유 강사 본인은 커리큘럼 공통 자료를 볼 수 있다.
        mockMvc.perform(get("/api/curriculums/" + curriculumId).cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.materials.length()").value(1))
                .andExpect(jsonPath("$.materials[0].fileName").value("deck.pptx"));
    }

    // ---- 헬퍼 ----

    private String createCurriculum(Cookie[] auth) throws Exception {
        MvcResult curriculum = write(post("/api/instructor/curriculums"), auth, "{\"title\":\"커리큘럼 자료 테스트\"}")
                .andExpect(status().isCreated()).andReturn();
        return json(curriculum).get("curriculumId").asString();
    }

    private String uploadedMaterialAsset(Cookie[] auth) throws Exception {
        String assetId = requestMaterialUpload(auth);
        write(post("/api/assets/" + assetId + "/complete"), auth, null).andExpect(status().isOk());
        return assetId;
    }

    private String requestMaterialUpload(Cookie[] auth) throws Exception {
        MvcResult r = write(post("/api/assets/upload-requests"), auth, """
                {"kind":"MATERIAL","fileName":"deck.pptx","contentType":"%s","fileSize":1048576}
                """.formatted(PPTX_TYPE))
                .andExpect(status().isOk()).andReturn();
        return json(r).get("assetId").asString();
    }

    private String uploadedThumbnailAsset(Cookie[] auth) throws Exception {
        MvcResult r = write(post("/api/assets/upload-requests"), auth, """
                {"kind":"THUMBNAIL","fileName":"t.png","contentType":"image/png","fileSize":2048}
                """)
                .andExpect(status().isOk()).andReturn();
        String assetId = json(r).get("assetId").asString();
        write(post("/api/assets/" + assetId + "/complete"), auth, null).andExpect(status().isOk());
        return assetId;
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
        String email = "curriculum-material-" + UUID.randomUUID() + "@liveclass.test";
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
