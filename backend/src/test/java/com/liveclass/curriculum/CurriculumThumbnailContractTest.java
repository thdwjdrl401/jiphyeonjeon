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
import java.util.Optional;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 커리큘럼 썸네일 연동 계약. 강사가 미리 올린 본인 UPLOADED THUMBNAIL 에셋을 지정하면 관리 뷰·카탈로그
 * 카드/상세에 presigned URL이 해석돼 나오고, 타인 소유·잘못된 종류·미완료 에셋은 거절된다.
 * 스토리지는 모킹(exists=true, presign은 고정 가짜 URL)해 실제 MinIO 없이 돈다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class CurriculumThumbnailContractTest {

    private static final String FAKE_URL = "http://fake-minio/download";

    @Autowired
    private MockMvc mockMvc;

    @MockitoBean
    private AssetStorage storage;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @BeforeEach
    void stubStorage() {
        when(storage.presignUpload(anyString(), anyString(), anyLong(), any(Duration.class)))
                .thenReturn(new AssetStorage.PresignedUpload("http://fake-minio/upload", OffsetDateTime.now().plusMinutes(10)));
        when(storage.presignDownload(anyString(), any(Duration.class))).thenReturn(FAKE_URL);
        when(storage.head(anyString()))
                .thenReturn(Optional.of(new AssetStorage.StoredObject(1024L, "image/png")));
    }

    @Test
    void create_with_own_uploaded_thumbnail_sets_url_and_shows_in_catalog() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        UUID thumbnailId = uploadedAsset(instructor, "THUMBNAIL");

        // 관리 뷰: 지정 즉시 thumbnailUrl 해석.
        MvcResult created = write(post("/api/instructor/curriculums"), instructor, """
                {"title":"썸네일 있는 과정","thumbnailAssetId":"%s"}
                """.formatted(thumbnailId))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.thumbnailUrl").value(FAKE_URL))
                .andReturn();
        String curriculumId = json(created).get("curriculumId").asString();

        // 발행 후 카탈로그 상세·목록에도 노출.
        // 게시 선행 조건(ADR-0006): 섹션·강의가 각각 1개 이상 있어야 발행된다.
        String seedSectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), instructor,
                "{\"title\":\"게시용 섹션\"}").andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
        write(post("/api/instructor/sections/" + seedSectionId + "/lessons"), instructor,
                "{\"title\":\"게시용 강의\"}").andExpect(status().isCreated());
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), instructor, null)
                .andExpect(status().isOk());

        mockMvc.perform(get("/api/curriculums/" + curriculumId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.thumbnailUrl").value(FAKE_URL));

        mockMvc.perform(get("/api/curriculums").param("q", "썸네일 있는 과정"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].thumbnailUrl").value(FAKE_URL));
    }

    @Test
    void update_with_own_uploaded_thumbnail_sets_url() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(instructor);
        UUID thumbnailId = uploadedAsset(instructor, "THUMBNAIL");

        write(org.springframework.test.web.servlet.request.MockMvcRequestBuilders
                .patch("/api/instructor/curriculums/" + curriculumId), instructor, """
                {"thumbnailAssetId":"%s"}
                """.formatted(thumbnailId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.thumbnailUrl").value(FAKE_URL));
    }

    @Test
    void create_with_other_users_asset_returns_409() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        UUID othersAsset = uploadedAsset(owner, "THUMBNAIL");

        Cookie[] intruder = loginAs("INSTRUCTOR");
        write(post("/api/instructor/curriculums"), intruder, """
                {"title":"도둑","thumbnailAssetId":"%s"}
                """.formatted(othersAsset))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_STATE_CONFLICT"));
    }

    @Test
    void create_with_wrong_kind_asset_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        UUID profileAsset = uploadedAsset(instructor, "PROFILE_IMAGE");

        write(post("/api/instructor/curriculums"), instructor, """
                {"title":"잘못된 종류","thumbnailAssetId":"%s"}
                """.formatted(profileAsset))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_STATE_CONFLICT"));
    }

    @Test
    void create_with_pending_asset_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        UUID pending = requestUpload(instructor, "THUMBNAIL"); // 완료 통지 없이 PENDING

        write(post("/api/instructor/curriculums"), instructor, """
                {"title":"미완료 썸네일","thumbnailAssetId":"%s"}
                """.formatted(pending))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_STATE_CONFLICT"));
    }

    // ---- 헬퍼 ----

    private String createCurriculum(Cookie[] auth) throws Exception {
        MvcResult r = write(post("/api/instructor/curriculums"), auth, """
                {"title":"기본 과정"}
                """).andExpect(status().isCreated()).andReturn();
        return json(r).get("curriculumId").asString();
    }

    /** upload-request → complete 로 UPLOADED 에셋을 만든다(스토리지 exists=true 모킹). */
    private UUID uploadedAsset(Cookie[] auth, String kind) throws Exception {
        UUID assetId = requestUpload(auth, kind);
        write(post("/api/assets/" + assetId + "/complete"), auth, null)
                .andExpect(status().isOk());
        return assetId;
    }

    private UUID requestUpload(Cookie[] auth, String kind) throws Exception {
        String contentType = "image/png";
        MvcResult r = write(post("/api/assets/upload-requests"), auth, """
                {"kind":"%s","fileName":"f.png","contentType":"%s","fileSize":1024}
                """.formatted(kind, contentType))
                .andExpect(status().isOk())
                .andReturn();
        return UUID.fromString(json(r).get("assetId").asString());
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
