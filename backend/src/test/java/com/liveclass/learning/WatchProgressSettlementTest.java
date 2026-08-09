package com.liveclass.learning;

import com.liveclass.learning.repository.LearningProgressRepository;
import com.liveclass.learning.service.WatchProgressSettlementImpl;
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

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 녹화가 준비되면 <b>라이브에서 쌓인 칸이 진도가 된다</b>(ADR-0117).
 *
 * <p>예전에는 이 환산을 학생 브라우저만 했다 — 다시보기를 열어야 반영됐고, 끝까지 듣고 열지 않으면
 * 0%로 남았다. 운영에서 "실시간으로 다 들었는데 왜 0%냐"가 나온 자리다.
 *
 * <p><b>환산 SQL과 리스너를 갈라서 시험한다.</b> 리스너는 커밋 뒤 별도 트랜잭션(REQUIRES_NEW)에서
 * 도는데, 롤백하는 테스트 트랜잭션 안에서는 아직 커밋되지 않은 시청 칸을 그 트랜잭션이 볼 수 없다.
 * 그대로 두면 <b>"아무 일도 일어나지 않아서" 통과하는 테스트</b>가 된다 — 처음 그렇게 썼다가 잡았다.
 * 그래서 SQL은 같은 트랜잭션에서 직접 부르고, 리스너는 목으로 호출 여부만 본다.
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class WatchProgressSettlementTest {

    /** 100초짜리 녹화 = 10칸. 아래 테스트가 쓰는 분모다. */
    private static final int TOTAL_BUCKETS = 10;
    private static final int COMPLETION_THRESHOLD = 90;

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private LearningProgressRepository progressRepository;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private String lastCurriculumId;

    @Test
    void live_watching_becomes_progress_without_opening_the_replay() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createEnrolledLesson(instructor);
        Cookie[] student = enrolledStudent(instructor);

        // 라이브를 들으며 10칸 중 9칸을 봤다. 이때는 길이를 몰라 진도가 나가지 않는다.
        report(student, lessonId, "{\"0\":1,\"1\":1,\"2\":1,\"3\":1,\"4\":1,\"5\":1,\"6\":1,\"7\":1,\"8\":1}");
        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.progress").doesNotExist());

        int settled = settle(lessonId);

        assertThat(settled).isEqualTo(1);
        // 다시보기를 열지 않았는데 진도가 채워진다.
        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.progress.progressPercent").value(90))
                .andExpect(jsonPath("$.progress.completed").value(true));
    }

    /** 다시 돌려도 결과가 같다 — 재처리·재시도가 안전해야 한다. */
    @Test
    void settling_twice_changes_nothing() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createEnrolledLesson(instructor);
        Cookie[] student = enrolledStudent(instructor);
        report(student, lessonId, "{\"0\":1,\"1\":1,\"2\":1}");

        settle(lessonId);
        settle(lessonId);

        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.progress.progressPercent").value(30))
                .andExpect(jsonPath("$.progress.completed").value(false));
    }

    /** 환산은 이미 쌓인 진도를 깎지 않는다(ADR-0116). 칸이 적어도 예전 값이 이긴다. */
    @Test
    void settling_never_lowers_an_existing_progress() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createEnrolledLesson(instructor);
        Cookie[] student = enrolledStudent(instructor);

        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":80,\"lastPositionMs\":80000}")
                .andExpect(status().isNoContent());
        report(student, lessonId, "{\"0\":1,\"1\":1}");   // 칸 기준으로는 20%

        int settled = settle(lessonId);

        assertThat(settled).isEqualTo(1);   // 행을 건드리긴 했다 — 값이 안 내려갔을 뿐이다
        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.progress.progressPercent").value(80))
                // 이어볼 위치는 환산이 건드리지 않는다 — 라이브 시청분에는 그런 위치가 없다.
                .andExpect(jsonPath("$.progress.lastPositionMs").value(80000));
    }

    /** 더 많이 본 경우에는 올린다 — 한 방향으로만 움직인다. */
    @Test
    void settling_raises_a_lower_existing_progress() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String lessonId = createEnrolledLesson(instructor);
        Cookie[] student = enrolledStudent(instructor);

        write(put("/api/lessons/" + lessonId + "/progress"), student,
                "{\"progressPercent\":10,\"lastPositionMs\":10000}")
                .andExpect(status().isNoContent());
        report(student, lessonId, "{\"0\":1,\"1\":1,\"2\":1,\"3\":1,\"4\":1,\"5\":1}");

        settle(lessonId);

        write(get("/api/lessons/" + lessonId + "/learning-context"), student, null)
                .andExpect(jsonPath("$.progress.progressPercent").value(60));
    }

    /** 길이를 모르면 분모가 없다. 잘못 계산하는 대신 아무것도 하지 않는다. */
    @Test
    void an_unknown_duration_settles_nothing() {
        LearningProgressRepository repository = mock(LearningProgressRepository.class);
        WatchProgressSettlementImpl settlement = new WatchProgressSettlementImpl(repository);

        settlement.settleFromRecording(UUID.randomUUID(), null);
        settlement.settleFromRecording(UUID.randomUUID(), 0L);

        verify(repository, never()).settleProgressFromWatchBuckets(any(), anyInt(), anyInt());
    }

    /** 환산이 화면과 같은 분모를 쓰는지. 여기가 어긋나면 같은 시청이 다른 비율로 보인다. */
    @Test
    void the_denominator_matches_the_screen_for_the_lesson_that_showed_4_percent() {
        LearningProgressRepository repository = mock(LearningProgressRepository.class);
        WatchProgressSettlementImpl settlement = new WatchProgressSettlementImpl(repository);
        UUID lessonId = UUID.randomUUID();

        // 운영에서 4%가 났던 그 강의: 244,050ms → 25칸.
        settlement.settleFromRecording(lessonId, 244_050L);

        verify(repository).settleProgressFromWatchBuckets(eq(lessonId), eq(25), eq(COMPLETION_THRESHOLD));
    }

    @Test
    void the_bucket_total_matches_the_screen_formula() {
        // 화면의 bucketProgressPercent와 같은 식이어야 한다 — ceil(길이 / 10초), 최소 1.
        assertThat(WatchProgressSettlementImpl.totalBuckets(100_000)).isEqualTo(10);
        assertThat(WatchProgressSettlementImpl.totalBuckets(100_001)).isEqualTo(11);
        assertThat(WatchProgressSettlementImpl.totalBuckets(1)).isEqualTo(1);
    }

    // ---- 헬퍼 ----

    /** 리스너가 하는 일과 같은 호출. 테스트 트랜잭션 안에서 도므로 방금 보고한 칸이 보인다. */
    private int settle(String lessonId) {
        return progressRepository.settleProgressFromWatchBuckets(
                UUID.fromString(lessonId), TOTAL_BUCKETS, COMPLETION_THRESHOLD);
    }

    private void report(Cookie[] auth, String lessonId, String counts) throws Exception {
        write(put("/api/lessons/" + lessonId + "/watch-buckets"), auth,
                "{\"bucketSizeMs\":10000,\"counts\":" + counts + "}")
                .andExpect(status().isNoContent());
    }

    private String createEnrolledLesson(Cookie[] instructor) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"진도 환산 테스트\"}")
                .andReturn()).get("curriculumId").asString();
        String sid = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), instructor, "{\"title\":\"섹션\"}")
                .andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
        String lessonId = json(write(post("/api/instructor/sections/" + sid + "/lessons"), instructor, "{\"title\":\"레슨\"}")
                .andExpect(status().isCreated()).andReturn()).get("lessonId").asString();
        write(post("/api/instructor/curriculums/" + cid + "/publish"), instructor, null)
                .andExpect(status().isOk());
        lastCurriculumId = cid;
        return lessonId;
    }

    private Cookie[] enrolledStudent(Cookie[] instructor) throws Exception {
        Cookie[] student = loginAs("STUDENT");
        String enrollmentId = json(write(post("/api/curriculums/" + lastCurriculumId + "/enrollments"), student, null)
                .andExpect(status().isCreated()).andReturn()).get("enrollmentId").asString();
        write(post("/api/instructor/curriculums/" + lastCurriculumId + "/enrollments/" + enrollmentId + "/approve"),
                instructor, null).andExpect(status().isOk());
        return student;
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
        builder = builder.cookie(cookies.toArray(new Cookie[0]))
                .header(csrfBody.get("headerName").asString(), csrfBody.get("token").asString());
        if (body != null) {
            builder = builder.contentType(MediaType.APPLICATION_JSON).content(body);
        }
        return mockMvc.perform(builder);
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "settle-" + UUID.randomUUID() + "@liveclass.test";
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
