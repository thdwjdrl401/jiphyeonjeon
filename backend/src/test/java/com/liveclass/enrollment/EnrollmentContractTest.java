package com.liveclass.enrollment;

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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 수강 계약 검증: 승인제 흐름(신청 PENDING → 승인 ACTIVE / 거절 REJECTED / 제적 REVOKED / 본인취소 CANCELLED)
 * + 가드(중복 신청·미발행·비소유 강사·잘못된 상태) + 강사 로스터(ENROLLEE-01, CURRICULUM_MANAGEMENT §8.1).
 */
@SpringBootTest
@AutoConfigureMockMvc
@Transactional
class EnrollmentContractTest {

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void apply_is_pending_then_instructor_approves_to_active() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);

        Account studentAcc = register("STUDENT");
        Cookie[] student = studentAcc.cookies();
        // 신청 → 승인제라 PENDING
        String eid = json(write(post("/api/curriculums/" + cid + "/enrollments"), student, null)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andReturn()).get("enrollmentId").asString();

        // 강사 로스터에 신청자 이름·이메일이 보강되어 뜬다
        write(get("/api/instructor/curriculums/" + cid + "/enrollments?status=PENDING"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].enrollmentId").value(eid))
                .andExpect(jsonPath("$.items[0].status").value("PENDING"))
                .andExpect(jsonPath("$.items[0].student.userId").exists())
                .andExpect(jsonPath("$.items[0].student.displayName").value(studentAcc.displayName()))
                .andExpect(jsonPath("$.items[0].student.email").value(studentAcc.email()))
                .andExpect(jsonPath("$.items[0].allowedTransitions.length()").value(2))
                .andExpect(jsonPath("$.items[0].allowedTransitions[0]").value("ACTIVE"))
                .andExpect(jsonPath("$.items[0].allowedTransitions[1]").value("REJECTED"))
                .andExpect(jsonPath("$.summary.pending").value(1))
                .andExpect(jsonPath("$.summary.active").value(0));

        // 승인 전 ACTIVE 필터는 비어 있다 — PENDING은 로스터(수강중)에 없다
        write(get("/api/instructor/curriculums/" + cid + "/enrollments?status=ACTIVE"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0))
                .andExpect(jsonPath("$.totalElements").value(0));

        // 강사 승인 → ACTIVE
        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("ACTIVE"));

        // ACTIVE 필터에 이름·이메일과 함께 나타난다. ACTIVE에서 강사가 할 수 있는 건 제적뿐
        write(get("/api/instructor/curriculums/" + cid + "/enrollments?status=ACTIVE"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].status").value("ACTIVE"))
                .andExpect(jsonPath("$.items[0].student.userId").exists())
                .andExpect(jsonPath("$.items[0].student.displayName").value(studentAcc.displayName()))
                .andExpect(jsonPath("$.items[0].student.email").value(studentAcc.email()))
                .andExpect(jsonPath("$.items[0].enrolledAt").exists())
                .andExpect(jsonPath("$.items[0].allowedTransitions.length()").value(1))
                .andExpect(jsonPath("$.items[0].allowedTransitions[0]").value("REVOKED"))
                .andExpect(jsonPath("$.summary.pending").value(0))
                .andExpect(jsonPath("$.summary.active").value(1));

        // 학생 내 수강 목록에 ACTIVE로
        write(get("/api/me/enrollments"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.length()").value(1))
                .andExpect(jsonPath("$[0].status").value("ACTIVE"));
    }

    @Test
    void instructor_rejects_pending_enrollment() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        Cookie[] student = loginAs("STUDENT");
        String eid = applyAndGetId(cid, student);

        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/reject"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REJECTED"))
                .andExpect(jsonPath("$.decidedAt").exists());

        // 거절된 건은 더 이상 강사가 취할 수 있는 전이가 없다(종료 상태)
        write(get("/api/instructor/curriculums/" + cid + "/enrollments?status=REJECTED"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].allowedTransitions.length()").value(0))
                .andExpect(jsonPath("$.summary.rejected").value(1));
    }

    @Test
    void reject_on_non_pending_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        Cookie[] student = loginAs("STUDENT");
        String eid = applyAndGetId(cid, student);

        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve"), instructor, null)
                .andExpect(status().isOk());
        // 이미 ACTIVE → 거절 불가
        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/reject"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_STATE_CONFLICT"));
    }

    @Test
    void instructor_revokes_active_enrollment() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        Cookie[] student = loginAs("STUDENT");
        String eid = applyAndGetId(cid, student);

        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve"), instructor, null)
                .andExpect(status().isOk());
        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/revoke"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("REVOKED"));

        write(get("/api/instructor/curriculums/" + cid + "/enrollments?status=REVOKED"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].allowedTransitions.length()").value(0))
                .andExpect(jsonPath("$.summary.revoked").value(1))
                .andExpect(jsonPath("$.summary.active").value(0));
    }

    @Test
    void revoke_on_pending_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        Cookie[] student = loginAs("STUDENT");
        String eid = applyAndGetId(cid, student);

        // 아직 PENDING → 제적 불가
        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/revoke"), instructor, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_STATE_CONFLICT"));
    }

    @Test
    void student_unenrolls_self() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        Cookie[] student = loginAs("STUDENT");
        String eid = applyAndGetId(cid, student);
        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + eid + "/approve"), instructor, null)
                .andExpect(status().isOk());

        write(delete("/api/curriculums/" + cid + "/enrollments/me"), student, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("CANCELLED"));

        // 두 번째 취소는 상태 충돌
        write(delete("/api/curriculums/" + cid + "/enrollments/me"), student, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_STATE_CONFLICT"));

        // 강사 로스터에서도 수강중이 아니다
        write(get("/api/instructor/curriculums/" + cid + "/enrollments"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.summary.active").value(0))
                .andExpect(jsonPath("$.summary.cancelled").value(1));
    }

    @Test
    void roster_pages_and_summarizes_mixed_statuses() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);

        // PENDING 1 · ACTIVE 1 · REJECTED 1 · REVOKED 1 (총 4건)
        applyAndGetId(cid, loginAs("STUDENT"));
        String toActivate = applyAndGetId(cid, loginAs("STUDENT"));
        String toReject = applyAndGetId(cid, loginAs("STUDENT"));
        String toRevoke = applyAndGetId(cid, loginAs("STUDENT"));
        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + toActivate + "/approve"), instructor, null)
                .andExpect(status().isOk());
        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + toReject + "/reject"), instructor, null)
                .andExpect(status().isOk());
        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + toRevoke + "/approve"), instructor, null)
                .andExpect(status().isOk());
        write(post("/api/instructor/curriculums/" + cid + "/enrollments/" + toRevoke + "/revoke"), instructor, null)
                .andExpect(status().isOk());

        // status 생략 → 전 상태. summary는 페이지·필터와 무관하게 커리큘럼 전체 기준
        write(get("/api/instructor/curriculums/" + cid + "/enrollments?page=0&size=2"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(2))
                .andExpect(jsonPath("$.totalElements").value(4))
                .andExpect(jsonPath("$.totalPages").value(2))
                .andExpect(jsonPath("$.hasNext").value(true))
                .andExpect(jsonPath("$.summary.pending").value(1))
                .andExpect(jsonPath("$.summary.active").value(1))
                .andExpect(jsonPath("$.summary.rejected").value(1))
                .andExpect(jsonPath("$.summary.revoked").value(1))
                .andExpect(jsonPath("$.summary.cancelled").value(0));

        write(get("/api/instructor/curriculums/" + cid + "/enrollments?page=1&size=2"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.hasNext").value(false));

        // 상태 필터
        write(get("/api/instructor/curriculums/" + cid + "/enrollments?status=PENDING"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].status").value("PENDING"));
        write(get("/api/instructor/curriculums/" + cid + "/enrollments?status=ACTIVE"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.items[0].enrollmentId").value(toActivate))
                .andExpect(jsonPath("$.items[0].status").value("ACTIVE"));

        // 필터 없이 전체 = 4건, 기본 size 20이라 한 페이지
        write(get("/api/instructor/curriculums/" + cid + "/enrollments"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(4))
                .andExpect(jsonPath("$.size").value(20))
                .andExpect(jsonPath("$.totalPages").value(1))
                .andExpect(jsonPath("$.hasNext").value(false));
    }

    @Test
    void roster_out_of_range_page_is_capped_not_500() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);

        // page*size 오프셋이 int를 넘으면 500이 나던 경로 — 잘라서 빈 페이지로 응답해야 한다.
        write(get("/api/instructor/curriculums/" + cid + "/enrollments?page=2000000000&size=100"), instructor, null)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(0));
    }

    @Test
    void double_apply_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);
        Cookie[] student = loginAs("STUDENT");

        write(post("/api/curriculums/" + cid + "/enrollments"), student, null).andExpect(status().isCreated());
        write(post("/api/curriculums/" + cid + "/enrollments"), student, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("ENROLLMENT_STATE_CONFLICT"));
    }

    @Test
    void apply_to_unpublished_curriculum_returns_409() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"미발행\"}")
                .andReturn()).get("curriculumId").asString();   // DRAFT 상태(발행 안 함)
        Cookie[] student = loginAs("STUDENT");

        write(post("/api/curriculums/" + cid + "/enrollments"), student, null)
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("CURRICULUM_STATE_CONFLICT"));
    }

    @Test
    void instructor_role_cannot_apply() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(instructor);

        // 강사 계정으로 수강 신청 → STUDENT 역할 아님 → 403(강사 수강 불가)
        write(post("/api/curriculums/" + cid + "/enrollments"), instructor, null)
                .andExpect(status().isForbidden());
    }

    @Test
    void non_owner_instructor_cannot_see_roster() throws Exception {
        Cookie[] owner = loginAs("INSTRUCTOR");
        String cid = createPublishedCurriculum(owner);
        Cookie[] other = loginAs("INSTRUCTOR");

        write(get("/api/instructor/curriculums/" + cid + "/enrollments"), other, null)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("CURRICULUM_FORBIDDEN"));
    }

    @Test
    void roster_of_unknown_curriculum_returns_404() throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");

        write(get("/api/instructor/curriculums/" + UUID.randomUUID() + "/enrollments"), instructor, null)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("CURRICULUM_NOT_FOUND"));
    }

    // ---- 헬퍼 ----

    private String createPublishedCurriculum(Cookie[] instructor) throws Exception {
        String cid = json(write(post("/api/instructor/curriculums"), instructor, "{\"title\":\"수강강좌\"}")
                .andReturn()).get("curriculumId").asString();
        write(post("/api/instructor/curriculums/" + cid + "/publish"), instructor, null).andExpect(status().isOk());
        return cid;
    }

    /** 학생 신청 → PENDING(승인제 기본). enrollmentId 반환. */
    private String applyAndGetId(String curriculumId, Cookie[] student) throws Exception {
        return json(write(post("/api/curriculums/" + curriculumId + "/enrollments"), student, null)
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("PENDING"))
                .andReturn()).get("enrollmentId").asString();
    }

    private org.springframework.test.web.servlet.ResultActions write(
            MockHttpServletRequestBuilder builder, Cookie[] authCookies, String body) throws Exception {
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
        return register(role).cookies();
    }

    /** 가입+로그인 계정. 보강된 이름·이메일을 검증하려면 이메일/표시명을 캡처해야 한다. */
    private record Account(Cookie[] cookies, String email, String displayName) {
    }

    private Account register(String role) throws Exception {
        String email = "enr-" + UUID.randomUUID() + "@liveclass.test";
        String displayName = "테스터-" + UUID.randomUUID().toString().substring(0, 8);
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"%s","role":"%s"}
                """.formatted(email, displayName, role)).andExpect(status().isCreated());
        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn();
        return new Account(login.getResponse().getCookies(), email, displayName);
    }

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
