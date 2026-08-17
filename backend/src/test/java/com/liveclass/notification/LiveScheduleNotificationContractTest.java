package com.liveclass.notification;

import com.liveclass.aiintegration.domain.OutboxEvent;
import com.liveclass.aiintegration.repository.OutboxEventRepository;
import com.liveclass.live.api.LiveSessionManagement;
import com.liveclass.live.service.LiveSessionService;
import com.liveclass.notification.config.NotificationMessagingConfig;
import com.liveclass.notification.service.NotificationFanoutWorker;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 라이브 일정 알림(ADR-0073, CONTRACT §2-4).
 *
 * <p>지키려는 것은 셋이다 — <b>알릴 일정이 있을 때만 나는가</b>, <b>일정이 실제로 바뀌었을 때만
 * 나는가</b>, <b>두 번째 변경이 첫 번째에 묻히지 않는가</b>.
 *
 * <p>마지막이 가장 위험하다. 중복 제거 키에 새 시각이 없으면 두 번째 변경 알림이 사라지고,
 * <b>학생은 옛 시각을 그대로 믿는다</b> — 알림이 없는 것보다 나쁘다.
 *
 * <p>{@code @Transactional}을 쓰지 않는다. 발행이 {@code BEFORE_COMMIT}이라 롤백되는 테스트
 * 트랜잭션 안에서는 아예 실행되지 않는다.
 */
@SpringBootTest
class LiveScheduleNotificationContractTest {

    @Autowired private LiveSessionManagement liveSessionManagement;
    @Autowired private LiveSessionService liveSessionService;
    @Autowired private OutboxEventRepository outboxEventRepository;
    @Autowired private NotificationFanoutWorker worker;
    @Autowired private JdbcTemplate jdbc;

    /** 브로커가 없다. 다음 조각 발행은 넓은 팬아웃 테스트가 따로 본다. */
    @MockitoBean private RabbitTemplate rabbitTemplate;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void scheduling_a_live_session_notifies_the_enrolled_students() {
        Fixture f = fixture();
        OffsetDateTime at = OffsetDateTime.now().plusDays(3);

        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, at).sessionId();

        List<JsonNode> payloads = onePayloadSetFor(sessionId);
        assertThat(payloads.getFirst().get("type").asString()).isEqualTo("LIVE_SCHEDULED");

        // 구간을 나눠 냈으므로 전부 처리해야 전원이 받는다.
        payloads.forEach(p -> worker.handle(p.toString()));
        List<Row> rows = notificationsFor(f.curriculumId);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().recipientId).isEqualTo(f.studentId);
        assertThat(rows.getFirst().message)
                .as("강의 제목은 워커가 찾아 넣는다 — 라이브 세션은 제목을 갖지 않는다")
                .contains(f.lessonTitle);
    }

    /**
     * 시각 없이 만든 초안에는 알릴 일정이 없다. 알리면 학생이 <b>"언제인지 모를 라이브"</b>를
     * 통보받는다.
     */
    @Test
    void a_draft_without_a_time_notifies_nobody() {
        Fixture f = fixture();

        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, null).sessionId();

        assertThat(fanoutPayloadsFor(sessionId)).isEmpty();
    }

    /** 입장창만 고친 것은 학생에게 알릴 일이 아니다. */
    @Test
    void changing_only_the_entry_window_is_not_a_schedule_change() {
        Fixture f = fixture();
        OffsetDateTime at = OffsetDateTime.now().plusDays(3);
        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, at).sessionId();

        liveSessionService.updateSchedule(sessionId, f.instructorId, null, 15, null);

        assertThat(payloadsOfType(sessionId, "LIVE_SCHEDULE_CHANGED")).isEmpty();
    }

    /** 같은 시각으로 다시 저장한 것도 변경이 아니다. */
    @Test
    void resaving_the_same_time_is_not_a_schedule_change() {
        Fixture f = fixture();
        OffsetDateTime at = OffsetDateTime.now().plusDays(3);
        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, at).sessionId();

        liveSessionService.updateSchedule(sessionId, f.instructorId, at, null, null);

        assertThat(payloadsOfType(sessionId, "LIVE_SCHEDULE_CHANGED")).isEmpty();
    }

    /**
     * <b>두 번째 변경이 첫 번째에 묻히면 안 된다.</b> 중복 제거 키에 새 시각이 없으면 두 번째
     * 알림이 사라지고, 학생은 옛 시각을 그대로 믿는다 — 알림이 없는 것보다 나쁘다.
     */
    @Test
    void a_second_reschedule_is_its_own_notification() {
        Fixture f = fixture();
        OffsetDateTime first = OffsetDateTime.now().plusDays(3);
        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, first).sessionId();

        liveSessionService.updateSchedule(sessionId, f.instructorId, first.plusDays(1), null, null);
        liveSessionService.updateSchedule(sessionId, f.instructorId, first.plusDays(2), null, null);

        List<JsonNode> changes = payloadsOfType(sessionId, "LIVE_SCHEDULE_CHANGED");
        assertThat(distinctEvents(changes)).as("두 번 바뀌었으면 사건이 둘이다").hasSize(2);
        changes.forEach(p -> worker.handle(p.toString()));

        assertThat(notificationsFor(f.curriculumId).stream()
                .filter(r -> "LIVE_SCHEDULE_CHANGED".equals(r.type)).toList())
                .as("두 번 바뀌었으면 두 번 알린다")
                .hasSize(2);
    }

    @Test
    void canceling_notifies_once_and_a_repeat_cancel_is_silent() {
        Fixture f = fixture();
        OffsetDateTime at = OffsetDateTime.now().plusDays(3);
        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, at).sessionId();

        liveSessionService.cancel(sessionId, f.instructorId);
        liveSessionService.cancel(sessionId, f.instructorId);   // 멱등 — 두 번째는 사건이 아니다

        List<JsonNode> canceled = payloadsOfType(sessionId, "LIVE_CANCELED");
        assertThat(distinctEvents(canceled)).as("두 번 취소해도 사건은 하나다").hasSize(1);

        canceled.forEach(p -> worker.handle(p.toString()));
        assertThat(notificationsFor(f.curriculumId).stream()
                .filter(r -> "LIVE_CANCELED".equals(r.type)).toList())
                .hasSize(1);
    }

    /**
     * 이 테스트는 커밋한다({@code BEFORE_COMMIT} 발행을 검증하려면 롤백할 수 없다). 남긴 아웃박스
     * 행은 <b>다른 테스트의 단언에 섞이므로</b> 직접 치운다 — 릴레이 테스트가 발행 횟수와 배치
     * 상한을 세기 때문이다.
     */
    @AfterEach
    void cleanUpCommittedRows() {
        // 워커가 조각마다 푸시 명령도 함께 싣는다(ADR-0124) — 그쪽 목적지도 치운다.
        jdbc.update("DELETE FROM core.outbox_events WHERE destination IN (?, ?)",
                NotificationMessagingConfig.FANOUT_QUEUE, NotificationMessagingConfig.PUSH_QUEUE);
    }

    // ---- helpers ----

    private record Fixture(UUID instructorId, UUID studentId, UUID curriculumId,
                           UUID sectionId, UUID lessonId, String lessonTitle) {
    }

    private record Row(UUID recipientId, String type, String message) {
    }

    private Fixture fixture() {
        UUID instructorId = seedUser("INSTRUCTOR");
        UUID studentId = seedUser("STUDENT");
        UUID curriculumId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.curriculum (id, instructor_id, title, lifecycle_status)
                VALUES (?, ?, ?, 'PUBLISHED')
                """, curriculumId, instructorId, "라이브 알림 커리큘럼");
        UUID sectionId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.section (id, curriculum_id, title, order_index)
                VALUES (?, ?, ?, 0)
                """, sectionId, curriculumId, "섹션");
        UUID lessonId = UUID.randomUUID();
        String lessonTitle = "라이브 강의 " + UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.lesson (id, section_id, title, order_index)
                VALUES (?, ?, ?, 0)
                """, lessonId, sectionId, lessonTitle);
        jdbc.update("""
                INSERT INTO core.enrollment (id, curriculum_id, user_id, status, requested_at)
                VALUES (?, ?, ?, 'ACTIVE', now())
                """, UUID.randomUUID(), curriculumId, studentId);
        return new Fixture(instructorId, studentId, curriculumId, sectionId, lessonId, lessonTitle);
    }

    private UUID seedUser(String role) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role, status)
                VALUES (?, ?, 'x', ?, ?, 'ACTIVE')
                """, id, "live-" + id + "@liveclass.test", "테스터", role);
        return id;
    }

    /** 사건이 정확히 하나인지 보고, 그 사건의 <b>모든 구간</b> 명령을 준다. */
    private List<JsonNode> onePayloadSetFor(UUID sessionId) {
        List<JsonNode> payloads = fanoutPayloadsFor(sessionId);
        assertThat(distinctEvents(payloads)).hasSize(1);
        return payloads;
    }

    /**
     * 구간 분할을 걷어낸 <b>사건</b> 목록. 넓은 팬아웃은 사건 하나를 uuid 구간 수만큼의 명령으로
     * 낸다(ADR-0130) — 이 테스트들이 세려는 것은 명령 수가 아니라 사건 수다.
     *
     * <p>구간 필드만 다르고 나머지가 같으면 같은 사건이다.
     */
    private List<JsonNode> distinctEvents(List<JsonNode> payloads) {
        java.util.Map<String, JsonNode> byEvent = new java.util.LinkedHashMap<>();
        for (JsonNode p : payloads) {
            tools.jackson.databind.node.ObjectNode key = ((tools.jackson.databind.node.ObjectNode) p).deepCopy();
            key.remove("afterUserId");
            key.remove("untilUserId");
            byEvent.putIfAbsent(key.toString(), p);
        }
        return List.copyOf(byEvent.values());
    }


    private List<JsonNode> payloadsOfType(UUID sessionId, String type) {
        return fanoutPayloadsFor(sessionId).stream()
                .filter(p -> type.equals(p.get("type").asString()))
                .toList();
    }

    private List<JsonNode> fanoutPayloadsFor(UUID sessionId) {
        return outboxEventRepository.findAll().stream()
                .filter(e -> NotificationMessagingConfig.FANOUT_QUEUE.equals(e.getDestination()))
                .filter(e -> sessionId.toString().equals(e.getAggregateId()))
                .map(OutboxEvent::getPayloadJson)
                .map(jsonMapper::readTree)
                .toList();
    }

    // 문구·targets는 사건당 한 행(content)으로 갔다(ADR-0123). 검증 내용은 그대로고 읽는 곳만 조인이다.
    private List<Row> notificationsFor(UUID curriculumId) {
        return jdbc.query("""
                        SELECT n.recipient_id, c.type, c.message
                        FROM core.notification n
                        JOIN core.notification_content c ON c.id = n.content_id
                        WHERE c.targets->>'curriculumId' = ?
                        """,
                (rs, i) -> new Row(rs.getObject("recipient_id", UUID.class),
                        rs.getString("type"), rs.getString("message")),
                curriculumId.toString());
    }
}
