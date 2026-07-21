package com.liveclass.auth;

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
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 프로필 이미지 연동 계약. 본인 UPLOADED PROFILE_IMAGE 에셋을 지정하면 /api/auth/me 응답에 presigned
 * URL이 해석돼 나오고, 타인 소유·잘못된 종류 에셋은 거절된다. 스토리지는 모킹해 실제 MinIO 없이 돈다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class ProfileImageContractTest {

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
    void set_own_uploaded_profile_image_then_me_returns_url() throws Exception {
        Cookie[] user = loginAs("STUDENT");
        UUID assetId = uploadedAsset(user, "PROFILE_IMAGE");

        write(put("/api/me/profile-image"), user, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.profileImageUrl").value(FAKE_URL));

        mockMvc.perform(get("/api/auth/me").cookie(user))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.profileImageUrl").value(FAKE_URL));
    }

    @Test
    void set_with_other_users_asset_returns_400() throws Exception {
        Cookie[] owner = loginAs("STUDENT");
        UUID othersAsset = uploadedAsset(owner, "PROFILE_IMAGE");

        Cookie[] intruder = loginAs("STUDENT");
        write(put("/api/me/profile-image"), intruder, """
                {"assetId":"%s"}
                """.formatted(othersAsset))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("AUTH_PROFILE_IMAGE_INVALID"));
    }

    @Test
    void set_with_wrong_kind_asset_returns_400() throws Exception {
        // THUMBNAIL은 강사만 만들 수 있으므로 강사로 로그인해 잘못된 종류를 프로필에 지정 시도.
        Cookie[] instructor = loginAs("INSTRUCTOR");
        UUID thumbnail = uploadedAsset(instructor, "THUMBNAIL");

        write(put("/api/me/profile-image"), instructor, """
                {"assetId":"%s"}
                """.formatted(thumbnail))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("AUTH_PROFILE_IMAGE_INVALID"));
    }

    // ---- 헬퍼 ----

    private UUID uploadedAsset(Cookie[] auth, String kind) throws Exception {
        MvcResult r = write(post("/api/assets/upload-requests"), auth, """
                {"kind":"%s","fileName":"f.png","contentType":"image/png","fileSize":1024}
                """.formatted(kind))
                .andExpect(status().isOk())
                .andReturn();
        UUID assetId = UUID.fromString(json(r).get("assetId").asString());
        write(post("/api/assets/" + assetId + "/complete"), auth, null)
                .andExpect(status().isOk());
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
