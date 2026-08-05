package com.liveclass.curriculum;

import com.liveclass.asset.service.AssetStorage;
import com.liveclass.lesson.api.LessonMaterialManagement;
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

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.ArrayList;
import java.util.Base64;
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
 * 자료→레슨 연결 계약 검증 (ADR-0035). 스토리지는 모킹해 실제 MinIO 없이 PPTX 업로드 완료를 흉내낸다.
 * 소유권(비소유 강사 403)·에셋 유효성(kind·완료 상태)·중복(409)·응답 필드명·레슨 상세 materials 채움을 본다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LessonMaterialContractTest {

    private static final String PPTX_TYPE =
            "application/vnd.openxmlformats-officedocument.presentationml.presentation";

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private LessonMaterialManagement lessonMaterialManagement;

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
        // 자료 업로드 완료 검증이 PPTX·크기를 통과하도록 head를 PPTX로 응답한다.
        when(storage.head(anyString()))
                .thenReturn(Optional.of(new AssetStorage.StoredObject(1_048_576L, PPTX_TYPE)));
    }

    @Test
    void attach_material_returns_201_with_contract_fields() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        String assetId = uploadedMaterialAsset(auth);

        write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.materialId").exists())
                .andExpect(jsonPath("$.assetId").value(assetId))
                .andExpect(jsonPath("$.fileName").value("deck.pptx"))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.embeddingStatus").value("READY"))
                .andExpect(jsonPath("$.keyTermStatus").value("NOT_REQUESTED"))
                .andExpect(jsonPath("$.material_id").doesNotExist());
    }

    @Test
    void attach_material_by_non_owner_returns_403() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String lessonId = createLesson(owner);

        Cookie[] intruder = loginAs("INSTRUCTOR");
        String assetId = uploadedMaterialAsset(intruder);

        write(post("/api/instructor/lessons/" + lessonId + "/materials"), intruder, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isForbidden());
    }

    @Test
    void attach_material_to_unknown_lesson_returns_404() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String assetId = uploadedMaterialAsset(auth);

        write(post("/api/instructor/lessons/" + UUID.randomUUID() + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isNotFound());
    }

    @Test
    void duplicate_attach_returns_409() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        String assetId = uploadedMaterialAsset(auth);

        write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isCreated());

        write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("MATERIAL_ALREADY_ATTACHED"));
    }

    @Test
    void attach_unknown_asset_returns_400() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);

        write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(UUID.randomUUID()))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MATERIAL_INVALID"));
    }

    @Test
    void attach_non_material_asset_returns_400() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        // THUMBNAIL 에셋(자료 아님)을 붙이려 하면 거부돼야 한다.
        when(storage.head(anyString()))
                .thenReturn(Optional.of(new AssetStorage.StoredObject(2048L, "image/png")));
        String thumbnailAssetId = uploadedThumbnailAsset(auth);
        // 이후 attach 검증이 head를 다시 보지 않도록(연결은 asset 상태만 본다) 무방.

        write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(thumbnailAssetId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MATERIAL_INVALID"));
    }

    @Test
    void attach_not_uploaded_asset_returns_400() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        // 업로드 요청만 하고 complete는 하지 않은 PENDING 에셋.
        String pendingAssetId = requestMaterialUpload(auth);

        write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(pendingAssetId))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("MATERIAL_INVALID"));
    }

    @Test
    void curriculum_detail_hides_materials_from_guest_and_unenrolled_student() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String curriculumId = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"자료 공개범위\"}")
                .andExpect(status().isCreated()).andReturn()).get("curriculumId").asString();
        String sectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), instructor,
                "{\"title\":\"1주차\"}").andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
        write(post("/api/instructor/sections/" + sectionId + "/lessons"), instructor,
                "{\"title\":\"1강\"}").andExpect(status().isCreated());
        // 게시 선행 조건(ADR-0006): 섹션·강의가 각각 1개 이상 있어야 발행된다.
        String seedSectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), instructor,
                "{\"title\":\"게시용 섹션\"}").andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
        write(post("/api/instructor/sections/" + seedSectionId + "/lessons"), instructor,
                "{\"title\":\"게시용 강의\"}").andExpect(status().isCreated());
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), instructor, null).andExpect(status().isOk());

        /*
         * 여기서 보는 것은 <b>가시성 게이트</b>다. 커리큘럼 상세의 materials는 커리큘럼-레벨 자료만
         * 담으므로(레슨 자료는 레슨 상세가 준다) 커리큘럼에 붙인다 — 레슨에 붙이면 게이트와 무관하게
         * 늘 0이라 이 테스트가 아무것도 지키지 못한다.
         */
        String assetId = uploadedMaterialAsset(instructor);
        write(post("/api/instructor/curriculums/" + curriculumId + "/materials"), instructor, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isCreated());

        // 게스트(비로그인) — 자료가 있어도 목록은 비어야 한다(ADR-0035 가시성 게이트).
        mockMvc.perform(get("/api/curriculums/" + curriculumId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.materials.length()").value(0));

        // 미수강 학생 — 마찬가지로 빈 목록.
        Cookie[] student = loginAs("STUDENT");
        mockMvc.perform(get("/api/curriculums/" + curriculumId).cookie(student))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.materials.length()").value(0));

        // 소유 강사 본인은 자기 자료를 볼 수 있다.
        mockMvc.perform(get("/api/curriculums/" + curriculumId).cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.materials.length()").value(1));
    }

    @Test
    void lesson_detail_includes_attached_materials() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        String assetId = uploadedMaterialAsset(auth);

        write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isCreated());

        // 소유 강사는 수강 관계 OWNER_INSTRUCTOR로 레슨 상세를 열 수 있다.
        mockMvc.perform(get("/api/lessons/" + lessonId).cookie(auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.materials.length()").value(1))
                .andExpect(jsonPath("$.materials[0].fileName").value("deck.pptx"))
                .andExpect(jsonPath("$.materials[0].materialId").exists());
    }

    @Test
    void instructor_lesson_get_includes_attached_materials() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        String assetId = uploadedMaterialAsset(auth);

        write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId))
                .andExpect(status().isCreated());

        // 강사 수정 폼의 데이터 소스(관리 GET)도 저장된 자료를 줘야 새로고침 후에도 유지된다.
        mockMvc.perform(get("/api/instructor/lessons/" + lessonId).cookie(auth))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.materials.length()").value(1))
                .andExpect(jsonPath("$.materials[0].fileName").value("deck.pptx"))
                .andExpect(jsonPath("$.materials[0].materialId").exists())
                .andExpect(jsonPath("$.materials[0].embeddingStatus").value("READY"))
                .andExpect(jsonPath("$.materials[0].keyTermStatus").value("NOT_REQUESTED"));
    }

    @Test
    void detach_material_removes_it_and_is_idempotent() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        String assetId = uploadedMaterialAsset(auth);
        String materialId = json(write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId)).andExpect(status().isCreated()).andReturn()).get("materialId").asString();

        // 삭제 → 204, 관리 GET에서 사라짐.
        write(delete("/api/instructor/lessons/" + lessonId + "/materials/" + materialId), auth, null)
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/instructor/lessons/" + lessonId).cookie(auth))
                .andExpect(jsonPath("$.materials.length()").value(0));

        // 멱등 — 이미 삭제된 걸 또 삭제해도 204.
        write(delete("/api/instructor/lessons/" + lessonId + "/materials/" + materialId), auth, null)
                .andExpect(status().isNoContent());
    }

    @Test
    void download_material_redirects_to_presigned_url() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        String assetId = uploadedMaterialAsset(auth);
        String materialId = json(write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId)).andExpect(status().isCreated()).andReturn()).get("materialId").asString();

        // 302 + Location(presigned GET) — 바이트는 스토리지 직결.
        mockMvc.perform(get("/api/instructor/lessons/" + lessonId + "/materials/" + materialId + "/download").cookie(auth))
                .andExpect(status().isFound())
                .andExpect(header().exists("Location"));
    }

    @Test
    void download_unknown_material_returns_404() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        mockMvc.perform(get("/api/instructor/lessons/" + lessonId + "/materials/" + UUID.randomUUID() + "/download").cookie(auth))
                .andExpect(status().isNotFound());
    }

    @Test
    void student_download_requires_active_enrollment_and_material_scope() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        PublishedLessonFixture fixture = createPublishedLessonFixture(instructor);
        String assetId = uploadedMaterialAsset(instructor);
        String materialId = json(write(post("/api/instructor/lessons/" + fixture.lessonId() + "/materials"),
                instructor, """
                {"assetId":"%s"}
                """.formatted(assetId)).andExpect(status().isCreated()).andReturn()).get("materialId").asString();
        String downloadPath = "/api/lessons/" + fixture.lessonId() + "/materials/" + materialId + "/download";

        // 학생 자료 API는 공개 조회가 아니다. 로그인하지 않으면 서비스 진입 전에 401이다.
        mockMvc.perform(get(downloadPath))
                .andExpect(status().isUnauthorized());

        Cookie[] student = loginAs("STUDENT");
        // 미수강 학생은 자료 id를 알아도 다운로드할 수 없다.
        mockMvc.perform(get(downloadPath).cookie(student))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_REQUIRED"));

        // 승인 대기(PENDING)도 활성 수강이 아니므로 여전히 403이다.
        String enrollmentId = json(write(post("/api/curriculums/" + fixture.curriculumId() + "/enrollments"),
                student, null).andExpect(status().isCreated()).andReturn()).get("enrollmentId").asString();
        mockMvc.perform(get(downloadPath).cookie(student))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_REQUIRED"));

        write(post("/api/instructor/curriculums/" + fixture.curriculumId()
                + "/enrollments/" + enrollmentId + "/approve"), instructor, null)
                .andExpect(status().isOk());

        // ACTIVE 수강생만 presigned GET URL로 리다이렉트된다.
        mockMvc.perform(get(downloadPath).cookie(student))
                .andExpect(status().isFound())
                .andExpect(header().string("Location", "http://fake-minio/download"));

        // 같은 커리큘럼을 수강 중이어도 자료가 연결되지 않은 다른 레슨 범위로 바꿔 요청할 수 없다.
        mockMvc.perform(get("/api/lessons/" + fixture.otherLessonId()
                        + "/materials/" + materialId + "/download").cookie(student))
                .andExpect(status().isNotFound());
    }

    @Test
    void ai_callback_updates_embedding_status_and_is_idempotent() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        String assetId = uploadedMaterialAsset(auth);
        String materialId = json(write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId)).andExpect(status().isCreated()).andReturn()).get("materialId").asString();

        // 콜백: 임베딩 실패 → FAILED (연결 직후 READY에서 관측 가능하게 바뀐다).
        String eventId = UUID.randomUUID().toString();
        String body = """
                {"eventId":"%s","eventType":"MATERIAL_EMBED_FAILED","materialId":"%s","status":"FAILED"}
                """.formatted(eventId, materialId);
        mockMvc.perform(post("/api/internal/ai/callbacks")
                        .contentType(MediaType.APPLICATION_JSON).content(body).header("X-Signature", signCallback(body)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/instructor/lessons/" + lessonId).cookie(auth))
                .andExpect(jsonPath("$.materials[0].embeddingStatus").value("FAILED"))
                .andExpect(jsonPath("$.materials[0].keyTermStatus").value("NOT_REQUESTED"));

        // 같은 eventId 재수신(이번엔 EMBEDDED) → 멱등 무시, 상태는 그대로 FAILED.
        String dup = """
                {"eventId":"%s","eventType":"MATERIAL_EMBEDDED","materialId":"%s","status":"READY"}
                """.formatted(eventId, materialId);
        mockMvc.perform(post("/api/internal/ai/callbacks")
                        .contentType(MediaType.APPLICATION_JSON).content(dup).header("X-Signature", signCallback(dup)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/instructor/lessons/" + lessonId).cookie(auth))
                .andExpect(jsonPath("$.materials[0].embeddingStatus").value("FAILED"));
    }

    @Test
    void ai_v2_callback_updates_embedding_and_key_term_status_independently() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String lessonId = createLesson(auth);
        String assetId = uploadedMaterialAsset(auth);
        String materialId = json(write(post("/api/instructor/lessons/" + lessonId + "/materials"), auth, """
                {"assetId":"%s"}
                """.formatted(assetId)).andExpect(status().isCreated()).andReturn()).get("materialId").asString();
        lessonMaterialManagement.updateEmbeddingStatus(UUID.fromString(materialId), "PENDING");
        lessonMaterialManagement.updateKeyTermStatus(UUID.fromString(materialId), "PENDING");

        // 임베딩은 정상이어도 GMS/용어 저장은 실패할 수 있다(ADR-0010 두 상태축).
        String body = """
                {
                  "eventId":"%s",
                  "eventType":"MATERIAL_EMBEDDED",
                  "jobId":"PPTX_EMBED:%s",
                  "materialId":"%s",
                  "lessonId":"%s",
                  "status":"READY",
                  "outputs":{
                    "materialVersionId":41,
                    "chunkCount":12,
                    "keyTermResult":{
                      "status":"FAILED",
                      "count":0,
                      "truncated":false,
                      "failureCode":"KEY_TERM_EXTRACTION_FAILED"
                    }
                  }
                }
                """.formatted(UUID.randomUUID(), materialId, materialId, lessonId);
        mockMvc.perform(post("/api/internal/ai/callbacks")
                        .contentType(MediaType.APPLICATION_JSON).content(body).header("X-Signature", signCallback(body)))
                .andExpect(status().isNoContent());

        mockMvc.perform(get("/api/instructor/lessons/" + lessonId).cookie(auth))
                .andExpect(jsonPath("$.materials[0].embeddingStatus").value("READY"))
                .andExpect(jsonPath("$.materials[0].keyTermStatus").value("FAILED"));

        // 다른 eventId의 지연 terminal 결과가 와도 먼저 확정된 용어 상태를 되돌리지 않는다.
        String delayed = body
                .replaceFirst("\"eventId\":\"[^\"]+\"", "\"eventId\":\"" + UUID.randomUUID() + "\"")
                .replace("\"status\":\"FAILED\"", "\"status\":\"EMPTY\"")
                .replace(",\n                      \"failureCode\":\"KEY_TERM_EXTRACTION_FAILED\"", "");
        mockMvc.perform(post("/api/internal/ai/callbacks")
                        .contentType(MediaType.APPLICATION_JSON).content(delayed)
                        .header("X-Signature", signCallback(delayed)))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/instructor/lessons/" + lessonId).cookie(auth))
                .andExpect(jsonPath("$.materials[0].keyTermStatus").value("FAILED"));
    }

    @Test
    void ai_callback_bad_signature_is_401() throws Exception {
        String body = """
                {"eventId":"e1","eventType":"MATERIAL_EMBEDDED","materialId":"%s"}
                """.formatted(UUID.randomUUID());
        mockMvc.perform(post("/api/internal/ai/callbacks")
                        .contentType(MediaType.APPLICATION_JSON).content(body).header("X-Signature", "wrong-signature"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void ai_callback_missing_signature_is_401() throws Exception {
        String body = """
                {"eventId":"e2","eventType":"MATERIAL_EMBEDDED","materialId":"%s"}
                """.formatted(UUID.randomUUID());
        mockMvc.perform(post("/api/internal/ai/callbacks")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
    }

    // ---- 자료 URL 주문형 발급(ADR-0036 B안): 워커가 처리 직전 호출 ----

    @Test
    void material_download_url_issued_for_signed_request() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        String assetId = uploadedMaterialAsset(auth);

        String body = """
                {"assetId":"%s"}
                """.formatted(assetId);
        mockMvc.perform(post("/api/internal/ai/materials/download-url")
                        .contentType(MediaType.APPLICATION_JSON).content(body).header("X-Signature", signCallback(body)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.url").value("http://fake-minio/download"));
    }

    @Test
    void material_download_url_missing_signature_is_401() throws Exception {
        String body = """
                {"assetId":"%s"}
                """.formatted(UUID.randomUUID());
        mockMvc.perform(post("/api/internal/ai/materials/download-url")
                        .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void material_download_url_for_non_material_asset_is_404() throws Exception {
        Cookie[] auth = loginAs("INSTRUCTOR");
        // 썸네일 완료 검증이 이미지 타입을 통과하도록 head를 이미지로 되돌린다(공유 스텁은 PPTX).
        when(storage.head(anyString()))
                .thenReturn(Optional.of(new AssetStorage.StoredObject(2048L, "image/png")));
        String thumbnailId = uploadedThumbnailAsset(auth);   // MATERIAL 아님 → 404(워커는 자료만 읽는다)

        String body = """
                {"assetId":"%s"}
                """.formatted(thumbnailId);
        mockMvc.perform(post("/api/internal/ai/materials/download-url")
                        .contentType(MediaType.APPLICATION_JSON).content(body).header("X-Signature", signCallback(body)))
                .andExpect(status().isNotFound());
    }

    /** AI 워커가 하는 것과 같은 방식으로 서명: ai.callback-secret HMAC-SHA256 → base64. */
    private String signCallback(String body) {
        try {
            Mac mac = Mac.getInstance("HmacSHA256");
            mac.init(new SecretKeySpec("dev-ai-callback-secret".getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
            return Base64.getEncoder().encodeToString(mac.doFinal(body.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception e) {
            throw new IllegalStateException(e);
        }
    }

    // ---- 헬퍼 ----

    /** 소유 강사의 커리큘럼→섹션→레슨을 만들고 레슨 id 반환. */
    private String createLesson(Cookie[] auth) throws Exception {
        MvcResult curriculum = write(post("/api/instructor/curriculums"), auth, "{\"title\":\"자료 테스트\"}")
                .andExpect(status().isCreated()).andReturn();
        String curriculumId = json(curriculum).get("curriculumId").asString();
        MvcResult section = write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth, "{\"title\":\"섹션\"}")
                .andExpect(status().isCreated()).andReturn();
        String sectionId = json(section).get("sectionId").asString();
        MvcResult lesson = write(post("/api/instructor/sections/" + sectionId + "/lessons"), auth, "{\"title\":\"1주차\"}")
                .andExpect(status().isCreated()).andReturn();
        return json(lesson).get("lessonId").asString();
    }

    private PublishedLessonFixture createPublishedLessonFixture(Cookie[] auth) throws Exception {
        String curriculumId = json(write(post("/api/instructor/curriculums"), auth,
                "{\"title\":\"수강생 자료 다운로드\"}")
                .andExpect(status().isCreated()).andReturn()).get("curriculumId").asString();
        String sectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth,
                "{\"title\":\"자료 섹션\"}")
                .andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sectionId + "/lessons"), auth,
                "{\"title\":\"자료가 있는 레슨\"}")
                .andExpect(status().isCreated()).andReturn()).get("lessonId").asString();
        String otherLessonId = json(write(post("/api/instructor/sections/" + sectionId + "/lessons"), auth,
                "{\"title\":\"다른 레슨\"}")
                .andExpect(status().isCreated()).andReturn()).get("lessonId").asString();
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), auth, null)
                .andExpect(status().isOk());
        return new PublishedLessonFixture(curriculumId, lessonId, otherLessonId);
    }

    private record PublishedLessonFixture(String curriculumId, String lessonId, String otherLessonId) {
    }

    /** PPTX 업로드 요청 → 완료까지 마친 MATERIAL 에셋 id. */
    private String uploadedMaterialAsset(Cookie[] auth) throws Exception {
        String assetId = requestMaterialUpload(auth);
        write(post("/api/assets/" + assetId + "/complete"), auth, null)
                .andExpect(status().isOk());
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
        builder = builder.cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder = builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "material-" + UUID.randomUUID() + "@liveclass.test";
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
