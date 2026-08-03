package com.liveclass.learning;

import com.liveclass.learning.service.WatchHeatmapService;
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
import java.util.List;
import java.util.UUID;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 구간별 시청 횟수 계약.
 *
 * <p>지키려는 것 셋이다.
 * <ul>
 *   <li><b>재전송이 횟수를 부풀리지 않는다</b> — 누적 절대값이라 같은 것을 여러 번 보내도 결과가 같다.</li>
 *   <li><b>강사 재생은 세지 않는다</b> — 검수하며 되감은 것이 학생 재시청으로 잡히면 그래프가 오염된다.</li>
 *   <li><b>이탈이 그래프를 우하향으로 만들지 않는다</b> — 절대 합이 아니라 도달자 수로 나눈 강도다.</li>
 * </ul>
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class WatchHeatmapContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void resending_the_same_counts_does_not_inflate_them() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createEnrolledLesson(instructor);
        Cookie[] student = enrolledStudent(instructor, lessonId);

        report(student, lessonId, "{\"0\":1,\"1\":2}");
        report(student, lessonId, "{\"0\":1,\"1\":2}");   // 재전송
        report(student, lessonId, "{\"0\":1,\"1\":2}");

        mockMvc.perform(get("/api/lessons/" + lessonId + "/watch-buckets/me").cookie(student))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$['1']").value(2));   // 6이 아니라 2
    }

    @Test
    void a_later_report_moves_the_count_forward_but_never_back() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createEnrolledLesson(instructor);
        Cookie[] student = enrolledStudent(instructor, lessonId);

        report(student, lessonId, "{\"5\":3}");
        // 새로고침 직후 클라이언트가 0부터 다시 세다가 보내는 경우 — 뒤로 가면 안 된다.
        report(student, lessonId, "{\"5\":1}");

        mockMvc.perform(get("/api/lessons/" + lessonId + "/watch-buckets/me").cookie(student))
                .andExpect(jsonPath("$['5']").value(3));
    }

    @Test
    void the_instructors_own_playback_is_not_counted() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createEnrolledLesson(instructor);

        // 강사가 검수하며 되감아도 그래프에 들어가면 안 된다.
        report(instructor, lessonId, "{\"0\":5}");

        mockMvc.perform(get("/api/lessons/" + lessonId + "/watch-heatmap").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.viewers").value(0))
                .andExpect(jsonPath("$.points.length()").value(0));
    }

    @Test
    void intensity_is_per_viewer_so_drop_off_does_not_tilt_the_graph() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createEnrolledLesson(instructor);
        Cookie[] a = enrolledStudent(instructor, lessonId);
        Cookie[] b = enrolledStudent(instructor, lessonId);

        // 둘 다 0번 칸을 한 번씩 봤다. 1번 칸은 한 명만 도달했지만 그 한 명이 두 번 봤다.
        report(a, lessonId, "{\"0\":1,\"1\":2}");
        report(b, lessonId, "{\"0\":1}");

        MvcResult result = mockMvc.perform(get("/api/lessons/" + lessonId + "/watch-heatmap").cookie(instructor))
                .andExpect(status().isOk()).andReturn();
        JsonNode points = json(result).get("points");

        // 절대 합이면 0번(2) > 1번(2)로 같아 보이지만, 도달자로 나누면 재시청한 1번이 더 높다.
        org.assertj.core.api.Assertions.assertThat(points.get(0).asDouble()).isEqualTo(1.0);
        org.assertj.core.api.Assertions.assertThat(points.get(1).asDouble()).isEqualTo(2.0);
    }

    @Test
    void a_wrong_bucket_size_is_rejected() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createEnrolledLesson(instructor);
        Cookie[] student = enrolledStudent(instructor, lessonId);

        // 칸 길이가 다르면 칸 번호가 다른 구간을 가리킨다. 섞이면 나중에 알아채기 어렵다.
        write(put("/api/lessons/" + lessonId + "/watch-buckets"), student,
                "{\"bucketSizeMs\":5000,\"counts\":{\"0\":1}}")
                .andExpect(status().isBadRequest());
    }

    @Test
    void an_empty_lesson_returns_an_empty_graph_not_an_error() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createEnrolledLesson(instructor);

        mockMvc.perform(get("/api/lessons/" + lessonId + "/watch-heatmap").cookie(instructor))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bucketSizeMs").value(WatchHeatmapService.BUCKET_SIZE_MS))
                .andExpect(jsonPath("$.points.length()").value(0));
    }

    // ---- 헬퍼 ----

    private org.springframework.test.web.servlet.ResultActions report(
            Cookie[] auth, String lessonId, String counts) throws Exception {
        return write(put("/api/lessons/" + lessonId + "/watch-buckets"), auth,
                "{\"bucketSizeMs\":10000,\"counts\":" + counts + "}")
                .andExpect(status().isNoContent());
    }

    /** 강사가 커리큘럼을 게시하고 레슨을 만든다(수강 신청은 게시본에서만 된다). */
    private String createEnrolledLesson(Cookie[] instructor) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"시청 그래프 테스트\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), instructor, "{\"title\":\"섹션\"}")
                .andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sid + "/lessons"), instructor, "{\"title\":\"레슨\"}")
                .andExpect(status().isCreated()).andReturn()).get("lessonId").asString();
        // 게시 선행 조건(ADR-0006): 섹션·강의가 각각 1개 이상. 위에서 이미 채웠다.
        write(post("/api/instructor/curriculums/" + cid + "/publish"), instructor, null)
                .andExpect(status().isOk());
        lastCurriculumId = cid;
        return lessonId;
    }

    private String lastCurriculumId;

    /** 수강 신청하고 강사가 승인한 학생(기존 학습 계약 테스트와 같은 흐름). */
    private Cookie[] enrolledStudent(Cookie[] instructor, String lessonId) throws Exception {
        Cookie[] student = loginAs("STUDENT");
        String enrollmentId = json(write(post("/api/curriculums/" + lastCurriculumId + "/enrollments"), student, null)
                .andExpect(status().isCreated()).andReturn()).get("enrollmentId").asString();
        write(post("/api/instructor/curriculums/" + lastCurriculumId + "/enrollments/" + enrollmentId + "/approve"),
                instructor, null).andExpect(status().isOk());
        return student;
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
        String email = "watch-" + UUID.randomUUID() + "@liveclass.test";
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
