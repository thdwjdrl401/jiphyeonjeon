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
 * 학습 상태 API 계약 (liveclass-102). 진도는 수강자만.
 *
 * <p>핵심: (1) 진도 upsert·90% 완료 sticky·순서역전 방어, (2) 수강 인가(미수강 403),
 * (3) 배선의 최종 목적 — 카탈로그 progress가 더 이상 항상 null이 아니다.
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
        String lessonId = addLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        // 처음엔 진도 없음.
        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.progress").doesNotExist());

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
        String lessonId = addLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        // 95% → 완료(임계 90).
        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":95,\"lastPositionMs\":600000}")
                .andExpect(status().isNoContent());
        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.progress.completed").value(true));

        /*
         * 10%를 보고해도 <b>진도는 내려가지 않는다</b>(ADR-0116). 예전에는 그대로 10%로 덮였고,
         * 운영에서 23칸(92%)을 본 학생이 다시보기를 잠깐 열었다가 4%로 기록됐다.
         * 완료 표시(sticky)는 예전부터 유지됐다 — 이제 진도율도 같이 지킨다.
         */
        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":10,\"lastPositionMs\":30000}")
                .andExpect(status().isNoContent());
        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.progress.completed").value(true))
                .andExpect(jsonPath("$.progress.progressPercent").value(95))
                // 위치는 최대값이 아니다 — "지금 어디를 보고 있나"라 마지막 값이 맞다(이어보기).
                .andExpect(jsonPath("$.progress.lastPositionMs").value(30000));
    }

    /**
     * 진도가 사람이 들인 시간인 이상, 클라이언트 사정으로 깎이면 안 된다. 완료 임계에 닿지 않는
     * 구간에서도 같은 규칙이 적용되는지 따로 못박는다 — 위 테스트는 sticky와 섞여 있다.
     */
    @Test
    void progress_never_goes_backwards() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = addLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":60,\"lastPositionMs\":300000}")
                .andExpect(status().isNoContent());

        // 빈 상태에서 다시 시작한 화면이 4%를 보고한다(운영에서 난 그 모양).
        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":4,\"lastPositionMs\":0}")
                .andExpect(status().isNoContent());

        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.progress.progressPercent").value(60))
                .andExpect(jsonPath("$.progress.completed").value(false));

        // 더 많이 본 보고는 그대로 반영된다 — 한 방향으로만 움직인다.
        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":80,\"lastPositionMs\":400000}")
                .andExpect(status().isNoContent());
        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.progress.progressPercent").value(80));
    }

    @Test
    void stale_client_update_is_ignored() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = addLesson(instructor, cid, "1강");
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
    void unenrolled_student_cannot_learn() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String lessonId = addLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");

        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_REQUIRED"));
        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":50,\"lastPositionMs\":1000}")
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
        String lessonId = addLesson(instructor, cid, "1강");
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
        // 게시용 시드 강의가 하나 있으므로(게시된 커리큘럼은 강의를 1개 이상 유지한다) 하나만 더한다.
        // 그래야 "2강 중 1강 완료 = 50%"라는 이 테스트의 계산이 그대로 성립한다.
        String l1 = addLesson(instructor, cid, "1강");
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

    /**
     * 목차의 <b>레슨별</b> 학습 상태. 커리큘럼 progress("몇 강 끝냈나")만으로는 목차에서 어느 강의를
     * 끝냈는지 알 수 없어, 진행률 막대는 움직이는데 완료 표시는 늘 비어 있었다.
     *
     * <p>진도 기록이 없는 레슨이 <b>null</b>로 남는 것까지 함께 못박는다 — 0%로 채우면 "안 본 강의"와
     * "보다 만 강의"가 화면에서 같아진다.
     */
    @Test
    void catalog_outline_lesson_carries_my_learning() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String l1 = addLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);

        write(put("/api/lessons/" + l1 + "/progress"), student,
                "{\"progressPercent\":100,\"lastPositionMs\":600000}")
                .andExpect(status().isNoContent());

        // 시드 강의가 outline[0], 방금 진도를 남긴 1강이 outline[1]이다(addLesson이 섹션을 새로 만든다).
        write(get("/api/curriculums/" + cid), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outline[1].lessons[0].lessonId").value(l1))
                .andExpect(jsonPath("$.outline[1].lessons[0].learning.completed").value(true))
                .andExpect(jsonPath("$.outline[1].lessons[0].learning.progressPercent").value(100))
                // 아직 열어 보지 않은 강의는 null 그대로다.
                .andExpect(jsonPath("$.outline[0].lessons[0].learning").doesNotExist());
    }

    /** 남의 진도가 새지 않는다. 목차는 비수강자도 보므로 게이트가 progress와 같아야 한다. */
    @Test
    void outline_learning_is_hidden_from_non_enrolled_viewer() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        String l1 = addLesson(instructor, cid, "1강");
        Cookie[] student = loginAs("STUDENT");
        approveEnrollment(instructor, student, cid);
        write(put("/api/lessons/" + l1 + "/progress"), student,
                "{\"progressPercent\":100,\"lastPositionMs\":600000}")
                .andExpect(status().isNoContent());

        Cookie[] other = loginAs("STUDENT");
        write(get("/api/curriculums/" + cid), other, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.outline[1].lessons[0].learning").doesNotExist())
                .andExpect(jsonPath("$.viewerContext.progress").doesNotExist());
    }

    @Test
    void learning_summary_aggregates_enrolled_progress() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        // 게시용 시드 강의가 하나 있으므로(게시된 커리큘럼은 강의를 1개 이상 유지한다) 하나만 더한다.
        // 그래야 "2강 중 1강 완료 = 50%"라는 이 테스트의 계산이 그대로 성립한다.
        String l1 = addLesson(instructor, cid, "1강");
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
        // 게시 선행 조건(ADR-0006): 섹션·강의가 각각 1개 이상 있어야 발행된다.
        String seedSectionId = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), instructor,
                "{\"title\":\"게시용 섹션\"}").andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
        String seedLessonId = json(write(post("/api/instructor/sections/" + seedSectionId + "/lessons"), instructor,
                "{\"title\":\"게시용 강의\"}").andExpect(status().isCreated()).andReturn()).get("lessonId").asString();
        write(post("/api/instructor/curriculums/" + cid + "/publish"), instructor, null).andExpect(status().isOk());
        return cid;
    }

    private String addLesson(Cookie[] instructor, String curriculumId, String title) throws Exception {
        String sectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), instructor,
                "{\"title\":\"1주차\"}").andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sectionId + "/lessons"), instructor,
                "{\"title\":\"%s\"}".formatted(title)).andReturn()).get("lessonId").asString();
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
