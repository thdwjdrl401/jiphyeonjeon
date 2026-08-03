package com.liveclass.notification;

import com.liveclass.aiintegration.domain.OutboxEvent;
import com.liveclass.aiintegration.repository.OutboxEventRepository;
import com.liveclass.notification.config.NotificationMessagingConfig;
import com.liveclass.notification.service.NotificationFanoutWorker;
import com.liveclass.video.api.RecordingFailedEvent;
import com.liveclass.video.api.RecordingReadyEvent;
import com.liveclass.video.api.ReplayPublishedEvent;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 녹화·다시보기 알림(ADR-0073, CONTRACT §2-4).
 *
 * <p>지키려는 것은 셋이다 — <b>녹화 소식이 강사에게만 가는가</b>, <b>다시보기 공개는 수강생 전원에게
 * 가는가</b>, <b>커리큘럼도 강사도 모르는 사건이 세션을 통해 채워지는가</b>.
 *
 * <p>마지막이 이 MR의 핵심이다. 녹화 자산은 커리큘럼도 강사도 모른다 — 라이브 세션만 안다.
 * 발행 시점에 그걸 조회하면 Egress webhook 처리 트랜잭션이 길어지므로 워커가 채운다.
 *
 * <p>사건을 직접 발행한다. 실제 경로(Egress webhook)를 태우려면 LiveKit·스토리지가 필요한데,
 * 여기서 보려는 것은 <b>사건에서 알림 행까지</b>이지 녹화가 만들어지는 경로가 아니다.
 */
@SpringBootTest
class RecordingNotificationContractTest {

    @Autowired private org.springframework.context.ApplicationEventPublisher eventPublisher;
    @Autowired private OutboxEventRepository outboxEventRepository;
    @Autowired private NotificationFanoutWorker worker;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private TransactionTemplate transactionTemplate;

    @MockitoBean private RabbitTemplate rabbitTemplate;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void a_ready_recording_tells_the_instructor_only() {
        Fixture f = fixture();
        UUID assetId = UUID.randomUUID();

        publish(new RecordingReadyEvent(assetId, f.lessonId, f.sessionId, OffsetDateTime.now()));
        worker.handle(onlyPayloadFor(assetId).toString());

        List<Row> rows = notificationsFor(f.curriculumId);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().recipientId)
                .as("검수하고 공개할 사람은 강사다")
                .isEqualTo(f.instructorId);
        assertThat(rows.getFirst().type).isEqualTo("RECORDING_READY");
        assertThat(rows.getFirst().message).contains(f.lessonTitle);
    }

    /**
     * 실패는 강사만 알아야 한다. 학생에게 보내면 <b>할 수 있는 일이 없는데 불안만 준다</b> —
     * 다시 찍을 사람은 강사다.
     */
    @Test
    void a_failed_recording_is_an_error_for_the_instructor_and_reaches_no_student() {
        Fixture f = fixture();
        UUID assetId = UUID.randomUUID();

        publish(new RecordingFailedEvent(assetId, f.lessonId, f.sessionId,
                "MANIFEST_MISSING", OffsetDateTime.now()));
        worker.handle(onlyPayloadFor(assetId).toString());

        List<Row> rows = notificationsFor(f.curriculumId);
        assertThat(rows).hasSize(1);
        assertThat(rows.getFirst().recipientId).isEqualTo(f.instructorId);
        assertThat(rows.getFirst().severity)
                .as("지나면 늦는 일이라 ERROR다")
                .isEqualTo("ERROR");
        assertThat(rows.getFirst().message)
                .as("실패 코드는 우리가 로그에서 볼 값이지 강사에게 할 말이 아니다")
                .doesNotContain("MANIFEST_MISSING");
    }

    @Test
    void publishing_a_replay_reaches_every_active_student() {
        Fixture f = fixture();
        UUID assetId = UUID.randomUUID();

        publish(new ReplayPublishedEvent(assetId, f.lessonId, f.sessionId, OffsetDateTime.now()));
        worker.handle(onlyPayloadFor(assetId).toString());

        List<Row> rows = notificationsFor(f.curriculumId);
        assertThat(rows.stream().map(Row::recipientId).toList())
                .containsExactlyInAnyOrderElementsOf(f.studentIds);
        assertThat(rows.getFirst().type).isEqualTo("VOD_PUBLISHED");
    }

    /**
     * 철회했다 다시 공개해도 학생에게 다시 알리지 않는다. 그 다시보기가 있다는 것은 이미 알고
     * 있고, 오갈 때마다 알리면 소음이 된다.
     */
    @Test
    void republishing_the_same_recording_does_not_notify_again() {
        Fixture f = fixture();
        UUID assetId = UUID.randomUUID();

        publish(new ReplayPublishedEvent(assetId, f.lessonId, f.sessionId, OffsetDateTime.now()));
        publish(new ReplayPublishedEvent(assetId, f.lessonId, f.sessionId, OffsetDateTime.now()));

        List<JsonNode> payloads = fanoutPayloadsFor(assetId);
        assertThat(payloads).as("아웃박스 멱등 키가 두 번째를 막는다").hasSize(1);
        worker.handle(payloads.getFirst().toString());
        assertThat(notificationsFor(f.curriculumId)).hasSize(f.studentIds.size());
    }

    /**
     * 세션이 사라졌으면 채울 것이 없다. <b>예외를 던지지 않는다</b> — 재시도해도 같고, 알릴 대상도
     * 없으므로 DLQ에 쌓아 둘 만큼 심각한 일이 아니다.
     */
    @Test
    void a_missing_session_ends_quietly_rather_than_poisoning_the_queue() {
        Fixture f = fixture();
        UUID assetId = UUID.randomUUID();
        publish(new ReplayPublishedEvent(assetId, f.lessonId, UUID.randomUUID(), OffsetDateTime.now()));

        worker.handle(onlyPayloadFor(assetId).toString());   // 던지지 않는다

        assertThat(notificationsFor(f.curriculumId)).isEmpty();
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

    private record Fixture(UUID instructorId, List<UUID> studentIds, UUID curriculumId,
                           UUID lessonId, UUID sessionId, String lessonTitle) {
    }

    private record Row(UUID recipientId, String type, String severity, String message) {
    }

    /** 발행은 BEFORE_COMMIT이라 커밋되는 트랜잭션 안에서 일어나야 한다. */
    private void publish(Object event) {
        transactionTemplate.executeWithoutResult(status -> eventPublisher.publishEvent(event));
    }

    @Transactional
    Fixture fixture() {
        UUID instructorId = seedUser("INSTRUCTOR");
        UUID curriculumId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.curriculum (id, instructor_id, title, lifecycle_status)
                VALUES (?, ?, ?, 'PUBLISHED')
                """, curriculumId, instructorId, "녹화 알림 커리큘럼");
        UUID sectionId = UUID.randomUUID();
        jdbc.update("INSERT INTO core.section (id, curriculum_id, title, order_index) VALUES (?, ?, ?, 0)",
                sectionId, curriculumId, "섹션");
        UUID lessonId = UUID.randomUUID();
        String lessonTitle = "녹화 강의 " + UUID.randomUUID();
        jdbc.update("INSERT INTO core.lesson (id, section_id, title, order_index) VALUES (?, ?, ?, 0)",
                lessonId, sectionId, lessonTitle);
        UUID sessionId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.live_session (id, lesson_id, curriculum_id, instructor_id, status)
                VALUES (?, ?, ?, ?, 'ENDED')
                """, sessionId, lessonId, curriculumId, instructorId);
        List<UUID> students = List.of(seedUser("STUDENT"), seedUser("STUDENT"));
        for (UUID studentId : students) {
            jdbc.update("""
                    INSERT INTO core.enrollment (id, curriculum_id, user_id, status, requested_at)
                    VALUES (?, ?, ?, 'ACTIVE', now())
                    """, UUID.randomUUID(), curriculumId, studentId);
        }
        return new Fixture(instructorId, students, curriculumId, lessonId, sessionId, lessonTitle);
    }

    private UUID seedUser(String role) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role, status)
                VALUES (?, ?, 'x', ?, ?, 'ACTIVE')
                """, id, "rec-" + id + "@liveclass.test", "테스터", role);
        return id;
    }

    private JsonNode onlyPayloadFor(UUID assetId) {
        List<JsonNode> payloads = fanoutPayloadsFor(assetId);
        assertThat(payloads).hasSize(1);
        return payloads.getFirst();
    }

    private List<JsonNode> fanoutPayloadsFor(UUID assetId) {
        return outboxEventRepository.findAll().stream()
                .filter(e -> NotificationMessagingConfig.FANOUT_QUEUE.equals(e.getDestination()))
                .filter(e -> assetId.toString().equals(e.getAggregateId()))
                .map(OutboxEvent::getPayloadJson)
                .map(jsonMapper::readTree)
                .toList();
    }

    private List<Row> notificationsFor(UUID curriculumId) {
        return jdbc.query("""
                        SELECT recipient_id, type, severity, message FROM core.notification
                        WHERE targets->>'curriculumId' = ?
                        """,
                (rs, i) -> new Row(rs.getObject("recipient_id", UUID.class), rs.getString("type"),
                        rs.getString("severity"), rs.getString("message")),
                curriculumId.toString());
    }
}
