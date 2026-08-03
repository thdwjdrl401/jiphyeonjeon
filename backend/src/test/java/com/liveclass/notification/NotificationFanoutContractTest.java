package com.liveclass.notification;

import com.liveclass.aiintegration.domain.OutboxEvent;
import com.liveclass.aiintegration.repository.OutboxEventRepository;
import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.EnrollmentType;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.notification.config.NotificationMessagingConfig;
import com.liveclass.notification.service.NotificationFanoutWorker;
import jakarta.servlet.http.Cookie;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * 수강 사건 → 아웃박스 → 워커 → 알림 행(ADR-0073 2단계).
 *
 * <p>지키려는 것은 넷이다 — <b>업무 트랜잭션과 같이 커밋되는가</b>, <b>알림 큐로 가는가</b>(AI 큐가
 * 아니라), <b>받는 사람과 처리 축이 맞는가</b>, <b>같은 사건이 두 번 와도 한 건인가</b>.
 *
 * <p><b>{@code @Transactional}을 쓰지 않는다.</b> 발행이 {@code BEFORE_COMMIT}에 걸려 있어서,
 * 롤백되는 테스트 트랜잭션 안에서는 <b>아예 실행되지 않는다</b> — 커밋이 일어나야 검증할 수 있다.
 * 대신 계정·커리큘럼을 매번 새로 만들어 테스트끼리 섞이지 않게 한다.
 */
@SpringBootTest
@AutoConfigureMockMvc
class NotificationFanoutContractTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private CurriculumRepository curriculumRepository;
    @Autowired private OutboxEventRepository outboxEventRepository;
    @Autowired private NotificationFanoutWorker worker;
    @Autowired private JdbcTemplate jdbc;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void an_approval_required_application_puts_one_message_on_the_notification_queue() throws Exception {
        Fixture f = approvalRequiredCurriculum();
        apply(f);

        OutboxEvent event = onlyFanoutEventFor(f.curriculumId);
        assertThat(event.getDestination())
                .as("알림은 알림 큐로 간다 — AI 임베딩 큐가 아니다")
                .isEqualTo(NotificationMessagingConfig.FANOUT_QUEUE);
        assertThat(event.getEventType()).isEqualTo("NOTIFICATION_FANOUT_REQUESTED");

        JsonNode payload = jsonMapper.readTree(event.getPayloadJson());
        assertThat(payload.get("type").asString()).isEqualTo("ENROLLMENT_REQUESTED");
        assertThat(payload.get("curriculumTitle").asString())
                .as("제목을 실어 보낸다 — 워커가 커리큘럼 모듈을 조회하지 않아도 되게")
                .isEqualTo(f.title);
    }

    /**
     * 즉시 수강에는 사건이 없다. 강사가 처리할 일이 없는데도 알림을 만들면 <b>처리 대기 목록이
     * 영영 줄지 않는다</b>.
     */
    @Test
    void an_immediate_enrollment_creates_no_notification_work() throws Exception {
        Fixture f = immediateCurriculum();
        apply(f);

        assertThat(fanoutEventsFor(f.curriculumId)).isEmpty();
    }

    @Test
    void the_worker_turns_the_message_into_an_action_required_row_for_the_instructor() throws Exception {
        Fixture f = approvalRequiredCurriculum();
        apply(f);
        worker.handle(onlyFanoutEventFor(f.curriculumId).getPayloadJson());

        List<Row> rows = notificationsFor(f.curriculumId);
        assertThat(rows).hasSize(1);
        Row row = rows.getFirst();
        assertThat(row.recipientId).isEqualTo(f.instructorId);
        assertThat(row.actionStatus)
                .as("강사에게는 할 일이 남는다 — 읽어도 승인 전까지 처리 대기다")
                .isEqualTo("ACTION_REQUIRED");
        assertThat(row.readStatus).isEqualTo("UNREAD");
        assertThat(row.message).contains(f.title);
    }

    @Test
    void approval_notifies_the_student_and_needs_no_action_from_them() throws Exception {
        Fixture f = approvalRequiredCurriculum();
        String enrollmentId = apply(f);
        decide(f, enrollmentId, "approve");

        Row row = runWorkerForLatest(f, "ENROLLMENT_APPROVED");
        assertThat(row.recipientId).isEqualTo(f.studentId);
        assertThat(row.actionStatus)
                .as("결과 통보는 읽고 끝이다")
                .isEqualTo("INFO");
        assertThat(row.message).contains("승인");
    }

    @Test
    void rejection_notifies_the_student_too() throws Exception {
        Fixture f = approvalRequiredCurriculum();
        String enrollmentId = apply(f);
        decide(f, enrollmentId, "reject");

        Row row = runWorkerForLatest(f, "ENROLLMENT_REJECTED");
        assertThat(row.recipientId).isEqualTo(f.studentId);
        assertThat(row.actionStatus).isEqualTo("INFO");
        assertThat(row.message).contains("거절");
    }

    /**
     * 릴레이가 발행 직후 죽으면 같은 메시지가 다시 온다. 중복은 코드가 아니라 {@code dedupe_key}
     * 유니크 제약이 막는다 — 두 번째는 0행으로 조용히 끝난다.
     */
    @Test
    void the_same_message_twice_still_makes_one_row() throws Exception {
        Fixture f = approvalRequiredCurriculum();
        apply(f);
        String payload = onlyFanoutEventFor(f.curriculumId).getPayloadJson();

        worker.handle(payload);
        worker.handle(payload);

        assertThat(notificationsFor(f.curriculumId)).hasSize(1);
    }

    /**
     * <b>거절당한 학생이 다시 신청하면 강사는 다시 알아야 한다.</b>
     *
     * <p>재신청은 새 행을 만들지 않고 <b>같은 수강 행을 되살린다</b>(EnrollmentService.apply). 그래서
     * 중복 제거 키가 {type}:{수신자}:{enrollmentId}까지였다면 두 번째 신청이 첫 번째와 같은 키가 되어
     * <b>조용히 사라진다</b> — 강사의 처리 대기 목록에 아무것도 뜨지 않는다. 사건 시각을 키에 넣는
     * 이유가 이것이다.
     */
    @Test
    void re_applying_after_a_rejection_notifies_the_instructor_again() throws Exception {
        Fixture f = approvalRequiredCurriculum();
        String first = apply(f);
        decide(f, first, "reject");
        apply(f);

        for (OutboxEvent event : fanoutEventsFor(f.curriculumId)) {
            worker.handle(event.getPayloadJson());
        }

        assertThat(notificationsFor(f.curriculumId).stream()
                .filter(r -> "ENROLLMENT_REQUESTED".equals(r.type))
                .toList())
                .as("첫 신청과 재신청은 서로 다른 알림이다")
                .hasSize(2);
    }

    /**
     * 계약에 없는 종류는 <b>재시도해도 같다</b>. 던져서 DLQ로 보낸다 — 큐에 되돌리면 그 메시지가
     * 영원히 같은 자리를 돌며 워커를 붙잡는다.
     */
    @Test
    void an_unknown_type_is_rejected_rather_than_retried_forever() {
        String payload = """
                {"type":"NOT_A_REAL_TYPE","enrollmentId":"%s","curriculumId":"%s",
                 "curriculumTitle":"x","instructorId":"%s","studentId":"%s","occurredAt":null}
                """.formatted(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());

        assertThatThrownBy(() -> worker.handle(payload))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("NOT_A_REAL_TYPE");
    }

    /**
     * 이 테스트는 커밋한다({@code BEFORE_COMMIT} 발행을 검증하려면 롤백할 수 없다). 남긴 아웃박스
     * 행은 <b>다른 테스트의 단언에 섞이므로</b> 직접 치운다 — 릴레이 테스트가 발행 횟수와 배치
     * 상한을 세기 때문이다.
     */
    @AfterEach
    void cleanUpCommittedRows() {
        jdbc.update("DELETE FROM core.outbox_events WHERE destination = ?",
                NotificationMessagingConfig.FANOUT_QUEUE);
    }

    // ---- helpers ----

    private record Fixture(String curriculumId, String title, UUID instructorId, UUID studentId,
                           Cookie[] instructor, Cookie[] student) {
    }

    private record Row(UUID recipientId, String type, String readStatus, String actionStatus, String message) {
    }

    private Fixture approvalRequiredCurriculum() throws Exception {
        return curriculum(EnrollmentType.APPROVAL_REQUIRED);
    }

    private Fixture immediateCurriculum() throws Exception {
        return curriculum(EnrollmentType.IMMEDIATE);
    }

    private Fixture curriculum(EnrollmentType type) throws Exception {
        Cookie[] instructor = loginAs("INSTRUCTOR");
        UUID instructorId = currentUserId(instructor);
        String title = "팬아웃강좌-" + UUID.randomUUID();
        String cid = json(write(post("/api/instructor/curriculums"), instructor,
                "{\"title\":\"%s\"}".formatted(title)).andReturn()).get("curriculumId").asString();
        String sectionId = json(write(post("/api/instructor/curriculums/" + cid + "/sections"), instructor,
                "{\"title\":\"섹션\"}").andExpect(status().isCreated()).andReturn()).get("sectionId").asString();
        write(post("/api/instructor/sections/" + sectionId + "/lessons"), instructor,
                "{\"title\":\"강의\"}").andExpect(status().isCreated());
        write(post("/api/instructor/curriculums/" + cid + "/publish"), instructor, null)
                .andExpect(status().isOk());

        Curriculum c = curriculumRepository.findById(UUID.fromString(cid)).orElseThrow();
        c.setEnrollmentType(type);
        curriculumRepository.saveAndFlush(c);

        Cookie[] student = loginAs("STUDENT");
        return new Fixture(cid, title, instructorId, currentUserId(student), instructor, student);
    }

    /** @return enrollmentId */
    private String apply(Fixture f) throws Exception {
        MvcResult result = write(post("/api/curriculums/" + f.curriculumId + "/enrollments"), f.student, null)
                .andExpect(status().is2xxSuccessful()).andReturn();
        return json(result).get("enrollmentId").asString();
    }

    private void decide(Fixture f, String enrollmentId, String action) throws Exception {
        write(post("/api/instructor/curriculums/" + f.curriculumId + "/enrollments/" + enrollmentId + "/" + action),
                f.instructor, null).andExpect(status().isOk());
    }

    private Row runWorkerForLatest(Fixture f, String type) {
        OutboxEvent event = fanoutEventsFor(f.curriculumId).stream()
                .filter(e -> e.getPayloadJson().contains("\"" + type + "\""))
                .findFirst().orElseThrow(() -> new AssertionError(type + " 팬아웃 요청이 없다"));
        worker.handle(event.getPayloadJson());
        return notificationsFor(f.curriculumId).stream()
                .filter(r -> type.equals(r.type))
                .findFirst().orElseThrow(() -> new AssertionError(type + " 알림이 없다"));
    }

    private OutboxEvent onlyFanoutEventFor(String curriculumId) {
        List<OutboxEvent> events = fanoutEventsFor(curriculumId);
        assertThat(events).hasSize(1);
        return events.getFirst();
    }

    private List<OutboxEvent> fanoutEventsFor(String curriculumId) {
        return outboxEventRepository.findAll().stream()
                .filter(e -> NotificationMessagingConfig.FANOUT_QUEUE.equals(e.getDestination()))
                .filter(e -> e.getPayloadJson() != null && e.getPayloadJson().contains(curriculumId))
                .toList();
    }

    private List<Row> notificationsFor(String curriculumId) {
        return jdbc.query("""
                        SELECT recipient_id, type, read_status, action_status, message
                        FROM core.notification
                        WHERE targets->>'curriculumId' = ?
                        ORDER BY created_at DESC
                        """,
                (rs, i) -> new Row(rs.getObject("recipient_id", UUID.class), rs.getString("type"),
                        rs.getString("read_status"), rs.getString("action_status"), rs.getString("message")),
                curriculumId);
    }

    private UUID currentUserId(Cookie[] cookies) throws Exception {
        MvcResult me = mockMvc.perform(get("/api/auth/me").cookie(cookies))
                .andExpect(status().isOk()).andReturn();
        return UUID.fromString(json(me).get("userId").asString());
    }

    private Cookie[] loginAs(String role) throws Exception {
        String email = "fan-" + UUID.randomUUID() + "@liveclass.test";
        write(post("/api/auth/signup"), null, """
                {"email":"%s","password":"password123","displayName":"테스터","role":"%s"}
                """.formatted(email, role)).andExpect(status().isCreated());
        MvcResult login = write(post("/api/auth/login"), null, """
                {"email":"%s","password":"password123"}
                """.formatted(email)).andExpect(status().isOk()).andReturn();
        return login.getResponse().getCookies();
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

    private JsonNode json(MvcResult result) throws Exception {
        return jsonMapper.readTree(result.getResponse().getContentAsString());
    }
}
