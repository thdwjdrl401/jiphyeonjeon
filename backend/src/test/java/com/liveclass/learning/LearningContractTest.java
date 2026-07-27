package com.liveclass.learning;

import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 학습 상태 API 계약 (liveclass-102). 진도·북마크는 수강자만.
 *
 * <p>핵심: (1) 진도 upsert·90% 완료 sticky·순서역전 방어, (2) 북마크 멱등, (3) 수강 인가(미수강 403),
 * (4) 배선의 최종 목적 — 카탈로그 progress가 더 이상 항상 null이 아니다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class LearningContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void progress_upsert_then_context_reflects_it() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = publishLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        // 처음엔 진도 없음.
        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.progress").doesNotExist())
                .andExpect(jsonPath("$.bookmarks").isArray());

        // 40% 저장 → 미완료.
        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":40,\"lastPositionMs\":120000}")
                .andExpect(status().isNoContent());

        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.progress.progressPercent").value(40))
                .andExpect(jsonPath("$.progress.lastPositionMs").value(120000))
                .andExpect(jsonPath("$.progress.completed").value(false));
    }

    @Test
    void progress_over_threshold_is_completed_and_sticky() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = publishLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        // 95% → 완료(임계 90).
        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":95,\"lastPositionMs\":600000}")
                .andExpect(status().isNoContent());
        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.progress.completed").value(true));

        // 다시 10%로 내려가도 completed는 유지(sticky).
        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":10,\"lastPositionMs\":30000}")
                .andExpect(status().isNoContent());
        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.progress.completed").value(true))
                .andExpect(jsonPath("$.progress.progressPercent").value(10));
    }

    @Test
    void stale_client_update_is_ignored() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = publishLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        // 최신 시각으로 60% 저장.
        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":60,\"lastPositionMs\":300000,\"clientUpdatedAt\":\"2026-07-24T12:00:00+09:00\"}")
                .andExpect(status().isNoContent());
        // 더 과거 시각으로 온 20%는 무시돼야 한다(진도 후퇴 방지).
        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":20,\"lastPositionMs\":100000,\"clientUpdatedAt\":\"2026-07-24T11:00:00+09:00\"}")
                .andExpect(status().isNoContent());

        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.progress.progressPercent").value(60));
    }

    @Test
    void bookmark_is_idempotent() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = publishLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        write(post("/api/lessons/" + lessonId + "/bookmarks"), student, "{\"sessionMs\":45000}")
                .andExpect(status().isCreated());
        // 같은 위치 다시 → 중복 생성 안 함.
        write(post("/api/lessons/" + lessonId + "/bookmarks"), student, "{\"sessionMs\":45000}")
                .andExpect(status().isCreated());
        write(post("/api/lessons/" + lessonId + "/bookmarks"), student, "{\"sessionMs\":90000}")
                .andExpect(status().isCreated());

        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.bookmarks.length()").value(2))
                .andExpect(jsonPath("$.bookmarks[0].sessionMs").value(45000))
                .andExpect(jsonPath("$.bookmarks[1].sessionMs").value(90000));
    }

    @Test
    void unenrolled_student_cannot_learn() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = publishLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");

        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_REQUIRED"));
        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":50,\"lastPositionMs\":1000}")
                .andExpect(status().isForbidden());
        write(post("/api/lessons/" + lessonId + "/bookmarks"), student, "{\"sessionMs\":1000}")
                .andExpect(status().isForbidden());
    }

    @Test
    void unknown_lesson_returns_404() throws Exception {
        Cookie[] student = loginAs("STUDENT");
        write(get("/api/lessons/" + UUID.randomUUID() + "/learning-context"), student, null)
                .andExpect(status().isNotFound());
    }

    @Test
    void invalid_progress_percent_is_rejected_400() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = publishLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":150,\"lastPositionMs\":1000}")
                .andExpect(status().isBadRequest());
    }

    @Test
    void catalog_progress_is_no_longer_always_null() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String l1 = publishLesson(instructor, cid, "1강");
        publishLesson(instructor, cid, "2강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        // 2강 중 1강 완료 → 50%.
        write(put("/api/lessons/" + l1 + "/progress"), student,
                "{\"progressPercent\":100,\"lastPositionMs\":600000}")
                .andExpect(status().isNoContent());

        // 커리큘럼 상세의 viewerContext.progress가 채워진다(배선 전엔 항상 null이었다).
        write(get("/api/curriculums/" + cid), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewerContext.progress.totalLessonCount").value(2))
                .andExpect(jsonPath("$.viewerContext.progress.completedLessonCount").value(1))
                .andExpect(jsonPath("$.viewerContext.progress.progressPercent").value(50));

        // 내 수강 목록 카드에도 실린다.
        write(get("/api/me/enrollments"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].curriculum.viewerContext.progress.progressPercent").value(50));
    }

    @Test
    void learning_summary_aggregates_enrolled_progress() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String l1 = publishLesson(instructor, cid, "1강");
        publishLesson(instructor, cid, "2강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        // 수강 직후: 진행 중 1, 완료 0, 완료 레슨 0, 평균 0.
        write(get("/api/me/learning-summary"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inProgressCurriculumCount").value(1))
                .andExpect(jsonPath("$.completedCurriculumCount").value(0))
                .andExpect(jsonPath("$.completedLessonCount").value(0))
                .andExpect(jsonPath("$.averageProgress").value(0));

        // 2강 중 1강 완료 → 완료 레슨 1, 평균 50, 아직 커리큘럼 완료 아님.
        write(put("/api/lessons/" + l1 + "/progress"), student,
                "{\"progressPercent\":100,\"lastPositionMs\":600000}")
                .andExpect(status().isNoContent());

        write(get("/api/me/learning-summary"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.completedLessonCount").value(1))
                .andExpect(jsonPath("$.averageProgress").value(50))
                .andExpect(jsonPath("$.inProgressCurriculumCount").value(1))
                .andExpect(jsonPath("$.completedCurriculumCount").value(0));
    }

    @Test
    void learning_summary_is_empty_without_enrollments() throws Exception {
        Cookie[] student = loginAs("STUDENT");
        write(get("/api/me/learning-summary"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.inProgressCurriculumCount").value(0))
                .andExpect(jsonPath("$.completedCurriculumCount").value(0))
                .andExpect(jsonPath("$.completedLessonCount").value(0))
                .andExpect(jsonPath("$.averageProgress").value(0));
    }

    // ---- 헬퍼 ----

    private String createPublishedCurriculum(Cookie[] instructor) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"학습강좌\"}")
                .andReturn()).get("curriculumId").asString();
        write(post("/api/instructor/curriculums/" + cid + "/publish"), instructor, null).andExpect(status().isOk());
        return cid;
    }

    private String publishLesson(Cookie[] instructor, String curriculumId, String title) throws Exception {
        String sectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), instructor,
                "{\"title\":\"1주차\"}").andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sectionId + "/lessons"), instructor,
                "{\"title\":\"%s\"}".formatted(title)).andReturn()).get("lessonId").asString();
        write(post("/api/instructor/lessons/" + lessonId + "/publish"), instructor, null).andExpect(status().isOk());
        return lessonId;
    }

    private void approveEnrollment(Cookie[] instructor, Cookie[] student, String curriculumId) throws Exception {
        String enrollmentId = json(write(post("/api/curriculums/" + curriculumId + "/enrollments"), student, null)
                .andExpect(status().isCreated()).andReturn()).get("enrollmentId").asString();
        write(post("/api/instructor/curriculums/" + curriculumId + "/enrollments/" + enrollmentId + "/approve"),
                instructor, null).andExpect(status().isOk());
    }

    private ResultActions write(MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body)
            throws Exception {
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
        String email = "learn-" + UUID.randomUUID() + "@liveclass.test";
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
