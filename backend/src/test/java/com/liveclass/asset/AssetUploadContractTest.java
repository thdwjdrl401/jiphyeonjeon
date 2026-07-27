package com.liveclass.asset;

import com.liveclass.asset.domain.Asset;
import com.liveclass.asset.domain.AssetStatus;
import com.liveclass.asset.repository.AssetRepository;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 에셋 업로드 계약 검증 (presigned direct-to-storage). 스토리지는 모킹해 실제 MinIO 없이 돈다 —
 * presignUpload/presignDownload는 고정 가짜 URL, exists는 기본 true(한 테스트만 false로 토글).
 * kind 게이트(THUMBNAIL=강사)·소유권·업로드 확인이 통째로 도는지 확인한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class AssetUploadContractTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private AssetRepository assetRepository;

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
                .thenReturn(Optional.of(new AssetStorage.StoredObject(1024L, "image/png")));
    }

    // ---- 업로드 요청 ----

    @Test
    void profile_image_upload_request_returns_200_ticket_and_pending_row() throws Exception {
        Cookie[] auth = loginAs("STUDENT");

        MvcResult result = write(post("/api/assets/upload-requests"), auth, """
                {"kind":"PROFILE_IMAGE","fileName":"avatar.png","contentType":"image/png","fileSize":1024}
                """)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assetId").exists())
                .andExpect(jsonPath("$.uploadUrl").value("http://fake-minio/upload"))
                .andExpect(jsonPath("$.method").value("PUT"))
                .andExpect(jsonPath("$.expiresAt").exists())
                .andReturn();

        UUID assetId = UUID.fromString(json(result).get("assetId").asString());
        Asset asset = assetRepository.findById(assetId).orElseThrow();
        assertThat(asset.getStatus()).isEqualTo(AssetStatus.PENDING);
        assertThat(asset.getKind().name()).isEqualTo("PROFILE_IMAGE");
    }

    @Test
    void thumbnail_upload_request_as_student_returns_403() throws Exception {
        Cookie[] auth = loginAs("STUDENT");

        write(post("/api/assets/upload-requests"), auth, """
                {"kind":"THUMBNAIL","fileName":"t.png","contentType":"image/png","fileSize":1024}
                """)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ASSET_FORBIDDEN"));
    }

    @Test
    void thumbnail_upload_request_as_instructor_returns_200() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");

        write(post("/api/assets/upload-requests"), auth, """
                {"kind":"THUMBNAIL","fileName":"t.png","contentType":"image/jpeg","fileSize":2048}
                """)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assetId").exists());
    }

    @Test
    void oversized_upload_request_returns_400_invalid() throws Exception {
        Cookie[] auth = loginAs("STUDENT");

        write(post("/api/assets/upload-requests"), auth, """
                {"kind":"PROFILE_IMAGE","fileName":"big.png","contentType":"image/png","fileSize":6291456}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ASSET_INVALID"));
    }

    @Test
    void disallowed_content_type_returns_400_invalid() throws Exception {
        Cookie[] auth = loginAs("STUDENT");

        write(post("/api/assets/upload-requests"), auth, """
                {"kind":"PROFILE_IMAGE","fileName":"doc.pdf","contentType":"application/pdf","fileSize":1024}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ASSET_INVALID"));
    }

    @Test
    void material_upload_request_as_instructor_returns_200() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");

        write(post("/api/assets/upload-requests"), auth, """
                {"kind":"MATERIAL","fileName":"deck.pptx","contentType":"application/vnd.openxmlformats-officedocument.presentationml.presentation","fileSize":1048576}
                """)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.assetId").exists());
    }

    @Test
    void material_upload_request_as_student_returns_403() throws Exception {
        Cookie[] auth = loginAs("STUDENT");

        write(post("/api/assets/upload-requests"), auth, """
                {"kind":"MATERIAL","fileName":"deck.pptx","contentType":"application/vnd.openxmlformats-officedocument.presentationml.presentation","fileSize":1048576}
                """)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ASSET_FORBIDDEN"));
    }

    @Test
    void material_non_pptx_content_type_returns_400() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");

        write(post("/api/assets/upload-requests"), auth, """
                {"kind":"MATERIAL","fileName":"m.pdf","contentType":"application/pdf","fileSize":1024}
                """)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ASSET_INVALID"));
    }

    // ---- 완료 ----

    @Test
    void complete_by_owner_marks_uploaded() throws Exception {
        Cookie[] auth = loginAs("STUDENT");
        UUID assetId = requestUpload(auth);

        write(post("/api/assets/" + assetId + "/complete"), auth, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("UPLOADED"));

        assertThat(assetRepository.findById(assetId).orElseThrow().getStatus())
                .isEqualTo(AssetStatus.UPLOADED);
    }

    @Test
    void complete_by_non_owner_returns_403() throws Exception {
        Cookie[] owner = loginAs("STUDENT");
        UUID assetId = requestUpload(owner);

        Cookie[] intruder = loginAs("STUDENT");
        write(post("/api/assets/" + assetId + "/complete"), intruder, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ASSET_FORBIDDEN"));
    }

    @Test
    void complete_when_storage_missing_returns_409() throws Exception {
        Cookie[] auth = loginAs("STUDENT");
        UUID assetId = requestUpload(auth);

        when(storage.head(anyString())).thenReturn(Optional.empty());
        write(post("/api/assets/" + assetId + "/complete"), auth, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ASSET_STATE_CONFLICT"));
    }

    @Test
    void complete_when_actual_file_oversized_returns_400() throws Exception {
        Cookie[] auth = loginAs("STUDENT");
        UUID assetId = requestUpload(auth);   // 티켓엔 1KB로 신고

        // 실제로는 6MiB가 올라온 상황(신고값과 무관하게 실제 크기로 차단).
        when(storage.head(anyString()))
                .thenReturn(Optional.of(new AssetStorage.StoredObject(6L * 1024 * 1024, "image/png")));
        write(post("/api/assets/" + assetId + "/complete"), auth, null)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ASSET_INVALID"));
    }

    @Test
    void complete_when_actual_type_not_allowed_returns_400() throws Exception {
        Cookie[] auth = loginAs("STUDENT");
        UUID assetId = requestUpload(auth);

        // 실제로는 이미지가 아닌 바이트가 올라온 상황.
        when(storage.head(anyString()))
                .thenReturn(Optional.of(new AssetStorage.StoredObject(1024L, "application/octet-stream")));
        write(post("/api/assets/" + assetId + "/complete"), auth, null)
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("ASSET_INVALID"));
    }

    // ---- 헬퍼 ----

    private UUID requestUpload(Cookie[] auth) throws Exception {
        MvcResult result = write(post("/api/assets/upload-requests"), auth, """
                {"kind":"PROFILE_IMAGE","fileName":"avatar.png","contentType":"image/png","fileSize":1024}
                """)
                .andExpect(status().isOk())
                .andReturn();
        return UUID.fromString(json(result).get("assetId").asString());
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
