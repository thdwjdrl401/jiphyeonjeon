package com.liveclass.curriculum;

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
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.time.temporal.ChronoUnit;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 강사 저작(authoring) 화면의 <b>읽기</b> 경로 계약. 여기서 잡으려는 실패는 하나다 — <b>방금 만든 것이
 * 안 보이는 것</b>. 강사 저작은 공개 카탈로그({@code /curriculums/{id}}, PUBLISHED-only)가 아니라
 * 강사 권한 축으로 읽어야, DRAFT 커리큘럼·레슨과 방금 건 라이브 일정이 보인다.
 *
 * <ul>
 *   <li>강사 레슨 조회가 <b>DRAFT</b>여도 라이브 세션을 함께 준다(#5 — 저장은 됐는데 새로고침하면 사라지던 것).
 *   <li>강사 대시보드 요약이 운영 지표를 집계한다(#2 — 예전엔 미구현이라 "준비 중" 배너).
 * </ul>
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class InstructorAuthoringReadContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    // ---- #5: 강사 레슨 조회가 (DRAFT여도) 라이브 세션을 준다 ----

    @Test
    void instructor_lesson_get_includes_live_session_for_unpublished_curriculum() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String curriculumId = createCurriculum(instructor);          // DRAFT (발행 안 함)
        String sectionId = createSection(instructor, curriculumId);
        String lessonId = createLesson(instructor, sectionId, "라이브 예정 강의");  // DRAFT
        write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), instructor,
                "{\"scheduledAt\":\"2026-08-01T10:00:00+09:00\"}")
                .andExpect(status().isCreated());

        // 커리큘럼·레슨 모두 DRAFT여도 강사 조회는 방금 만든 세션을 그대로 돌려준다.
        write(get("/api/instructor/lessons/" + lessonId), instructor, null)
                .andExpect(status().isOk())
                                .andExpect(jsonPath("$.liveSession.sessionId").exists())
                .andExpect(jsonPath("$.liveSession.status").value("SCHEDULED"))
                .andExpect(jsonPath("$.liveSession.scheduledAt").exists());
    }

    @Test
    void instructor_lesson_get_has_null_live_session_when_none() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String sectionId = createSection(instructor);
        String lessonId = createLesson(instructor, sectionId, "일정 없는 강의");

        write(get("/api/instructor/lessons/" + lessonId), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.liveSession").doesNotExist());
    }

    // ---- #2: 강사 대시보드 요약 ----

    @Test
    void dashboard_summary_aggregates_instructor_operations() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String published = createCurriculum(instructor);
        publishCurriculum(instructor, published);
        createCurriculum(instructor);   // DRAFT 하나 더

        // 공개 커리큘럼에 라이브 예정 세션 + 승인된 수강생 하나.
        String sectionId = createSection(instructor, published);
        String lessonId = createLesson(instructor, sectionId, "1강");
        /*
         * <b>고정 날짜를 쓰지 않는다.</b> `upcomingLiveCount`와 `upcomingLiveSession`은 "앞으로 있을"
         * 라이브를 세므로, 박아 둔 시각이 지나가는 순간 테스트가 저절로 깨진다 — 실제로
         * 2026-08-01이 지나며 master가 빨개졌다. 코드가 바뀌지 않았는데 날짜만으로 깨지는 테스트는
         * 신호가 아니라 소음이다.
         */
        String scheduledAt = OffsetDateTime.now(ZoneOffset.ofHours(9)).plusDays(1)
                .truncatedTo(ChronoUnit.MINUTES).toString();
        String sessionId = json(write(post("/api/instructor/lessons/" + lessonId + "/live-sessions"), instructor,
                "{\"scheduledAt\":\"%s\"}".formatted(scheduledAt))
                .andExpect(status().isCreated()).andReturn()).get("sessionId").asString();
        // 예상 진행 시간은 생성이 아니라 일정 수정으로 들어간다(강사가 강의 폼에서 입력하는 값).
        write(patch("/api/instructor/live-sessions/" + sessionId), instructor,
                "{\"expectedDurationMinutes\":90}").andExpect(status().isOk());
        enrollAndApprove(instructor, published);

        write(get("/api/instructor/dashboard-summary"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalCurriculumCount").value(2))
                .andExpect(jsonPath("$.publishedCurriculumCount").value(1))
                .andExpect(jsonPath("$.upcomingLiveCount").value(1))
                .andExpect(jsonPath("$.totalEnrolleeCount").value(1))
                .andExpect(jsonPath("$.upcomingLiveSession.sessionId").exists())
                .andExpect(jsonPath("$.upcomingLiveSession.lessonTitle").value("1강"))
                .andExpect(jsonPath("$.upcomingLiveSession.curriculumTitle").exists())
                /*
                 * <b>강사가 입력한 예상 진행 시간이 그대로 와야 한다.</b> 전에는 이 자리에 녹화 길이를
                 * 뜻하는 durationMs가 있어 예정된 라이브에서는 언제나 null이었고, 화면은 "예상 --분"만
                 * 보여 줬다. 값이 다시 조용히 비면 화면도 조용히 되돌아가므로 여기서 고정한다.
                 */
                .andExpect(jsonPath("$.upcomingLiveSession.expectedDurationMinutes").value(90));
    }

    @Test
    void dashboard_summary_is_empty_for_instructor_without_curriculums() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        write(get("/api/instructor/dashboard-summary"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalCurriculumCount").value(0))
                .andExpect(jsonPath("$.upcomingLiveSession").doesNotExist());
    }

    @Test
    void dashboard_summary_requires_instructor_role() throws Exception {
        Cookie[] student = loginAs("STUDENT");
        write(get("/api/instructor/dashboard-summary"), student, null)
                .andExpect(status().isForbidden());
    }

    // ---- 헬퍼 ----

    private String createCurriculum(Cookie[] auth) throws Exception {
        return json(write(post("/api/instructor/curriculums"), auth, "{\"title\":\"저작 읽기 테스트\"}")
                .andExpect(status().isCreated()).andReturn()).get("curriculumId").asString();
    }

    private void publishCurriculum(Cookie[] auth, String curriculumId) throws Exception {
        // 게시 선행 조건(ADR-0006): 섹션·강의가 각각 1개 이상 있어야 발행된다.
        String seedSectionId = json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth,
                "{\"title\":\"게시용 섹션\"}").andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
        write(post("/api/instructor/sections/" + seedSectionId + "/lessons"), auth,
                "{\"title\":\"게시용 강의\"}").andExpect(status().isCreated());
        write(post("/api/instructor/curriculums/" + curriculumId + "/publish"), auth, null).andExpect(status().isOk());
    }

    private String createSection(Cookie[] auth) throws Exception {
        return createSection(auth, createCurriculum(auth));
    }

    private String createSection(Cookie[] auth, String curriculumId) throws Exception {
        return json(write(post("/api/instructor/curriculums/" + curriculumId + "/sections"), auth, "{\"title\":\"섹션\"}")
                .andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
    }

    private String createLesson(Cookie[] auth, String sectionId, String title) throws Exception {
        return json(write(post("/api/instructor/sections/" + sectionId + "/lessons"), auth,
                "{\"title\":\"" + title + "\"}").andExpect(status().isCreated()).andReturn()).get("lessonId").asString();
    }

    private void enrollAndApprove(Cookie[] instructor, String curriculumId) throws Exception {
        Cookie[] student = loginAs("STUDENT");
        String enrollmentId = json(write(post("/api/curriculums/" + curriculumId + "/enrollments"), student, null)
                .andExpect(status().isCreated()).andReturn()).get("enrollmentId").asString();
        write(post("/api/instructor/curriculums/" + curriculumId + "/enrollments/" + enrollmentId + "/approve"),
                instructor, null).andExpect(status().isOk());
    }

    private ResultActions write(MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body)
            throws Exception {
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
        String email = "authoring-" + UUID.randomUUID() + "@liveclass.test";
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
