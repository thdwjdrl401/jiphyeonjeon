package com.liveclass.notification;

import com.liveclass.aiintegration.domain.OutboxEvent;
import com.liveclass.aiintegration.repository.OutboxEventRepository;
import com.liveclass.live.api.LiveSessionManagement;
import com.liveclass.live.service.LiveSessionService;
import com.liveclass.notification.api.NotificationLeadTimes;
import com.liveclass.notification.config.NotificationMessagingConfig;
import com.liveclass.notification.domain.NotificationSchedule;
import com.liveclass.notification.repository.NotificationScheduleRepository;
import com.liveclass.notification.service.LiveStartingSoonScheduler;
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
 * 라이브 곧 시작 알림과 발화 예정 표(ADR-0073 §6).
 *
 * <p>12종 중 <b>유일하게 아무 사건 없이 시각이 되면 나가야 하는</b> 종류다. 지키려는 것은 넷이다 —
 * <b>예약이 시각만 담는가</b>(수신자를 미리 펼치지 않는가), <b>일정이 바뀌면 따라 옮겨지는가</b>,
 * <b>취소되면 사라지는가</b>, <b>때를 놓친 발화가 거짓말을 하지 않는가</b>.
 *
 * <p>마지막이 중요하다. 배포·장애로 폴링이 멈춘 사이 시작 시각이 지나갔다면 "곧 시작합니다"는
 * 거짓이다 — 이미 하고 있거나 끝난 라이브다.
 */
@SpringBootTest
class LiveStartingSoonContractTest {

    @Autowired private LiveSessionManagement liveSessionManagement;
    @Autowired private LiveSessionService liveSessionService;
    @Autowired private NotificationScheduleRepository scheduleRepository;
    @Autowired private LiveStartingSoonScheduler scheduler;
    @Autowired private NotificationFanoutWorker worker;
    @Autowired private OutboxEventRepository outboxEventRepository;
    @Autowired private JdbcTemplate jdbc;

    @MockitoBean private RabbitTemplate rabbitTemplate;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    /**
     * 예약 행에는 <b>시각만</b> 있다. 수강생 수와 무관하게 <b>리드타임 선택지 수만큼</b>이다 —
     * 예약 시점에 사람별 행을 만들면 그때의 명단이 굳어, 뒤에 수강한 사람은 못 받고 취소한 사람은
     * 받는다.
     *
     * <p>선택지 전부를 미리 만드는 이유는 <b>설정이 바뀌어도 예정 표를 손대지 않기 위해서</b>다.
     * 고른 사람이 없는 리드타임의 행은 발화해도 0건을 넣고 끝난다(ADR-0073 4단계).
     */
    @Test
    void scheduling_a_live_creates_one_row_per_lead_choice_regardless_of_roster_size() {
        Fixture f = fixture(3);
        OffsetDateTime startsAt = OffsetDateTime.now().plusHours(2);

        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, startsAt).sessionId();

        List<NotificationSchedule> rows = schedulesOf(sessionId);
        assertThat(rows)
                .as("수강생이 셋이어도 행 수는 리드타임 선택지 수와 같다")
                .hasSize(NotificationLeadTimes.CHOICES.size());
        assertThat(rows).allSatisfy(row ->
                assertThat(row.getFireAt())
                        .isCloseTo(startsAt.minusMinutes(row.getLeadMinutes()), within1Second()));
        assertThat(rows).allSatisfy(row -> assertThat(row.getFiredAt()).isNull());
    }

    @Test
    void rescheduling_moves_the_pending_fire_time() {
        Fixture f = fixture(1);
        OffsetDateTime startsAt = OffsetDateTime.now().plusHours(2);
        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, startsAt).sessionId();

        OffsetDateTime moved = startsAt.plusHours(3);
        liveSessionService.updateSchedule(sessionId, f.instructorId, moved, null, null);

        List<NotificationSchedule> rows = schedulesOf(sessionId);
        assertThat(rows).hasSize(NotificationLeadTimes.CHOICES.size());
        assertThat(rows).allSatisfy(row ->
                assertThat(row.getFireAt())
                        .isCloseTo(moved.minusMinutes(row.getLeadMinutes()), within1Second()));
    }

    /** 취소된 라이브에 "곧 시작합니다"가 나가면 안 된다. */
    @Test
    void canceling_removes_the_schedule() {
        Fixture f = fixture(1);
        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, OffsetDateTime.now().plusHours(2))
                .sessionId();

        liveSessionService.cancel(sessionId, f.instructorId);

        assertThat(schedulesOf(sessionId)).isEmpty();
    }

    /**
     * 시각이 되면 아웃박스에 <b>한 줄</b>이 들어간다. 폴링이 수신자를 훑지 않는 것이 요점이다 —
     * 명단은 워커가 커서로 나눠서 본다.
     */
    @Test
    void a_due_schedule_puts_one_row_on_the_outbox_and_never_fires_twice() {
        Fixture f = fixture(2);
        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, OffsetDateTime.now().plusMinutes(9))
                .sessionId();   // 기본 10분 행의 발화 시각이 이미 지났다(5분 행은 아직이다)

        scheduler.fireDue();
        scheduler.fireDue();   // 두 번 돌아도 한 번만

        /*
         * 시각이 지난 행만 발화한다 — 9분 뒤 시작이면 10분·30분·1시간·3시간·하루 전 행이 모두
         * 지났고, 5분 전 행만 아직이다.
         */
        List<JsonNode> payloads = fanoutPayloadsFor(sessionId, "LIVE_STARTING_SOON");
        assertThat(distinctEvents(payloads)).hasSize(NotificationLeadTimes.CHOICES.size() - 1);
        assertThat(schedulesOf(sessionId).stream().filter(r -> r.getFiredAt() != null).toList())
                .hasSize(NotificationLeadTimes.CHOICES.size() - 1);

        /*
         * 설정하지 않은 사람은 기본값(10분)이다. 그래서 10분 행만 실제로 알림을 만들고 나머지
         * 리드타임 행은 0건으로 끝난다 — 아무도 그 값을 고르지 않았기 때문이다.
         */
        payloads.forEach(p -> worker.handle(p.toString()));
        assertThat(recipientsOf(f.curriculumId, "LIVE_STARTING_SOON"))
                .as("수강생 전원 + 담당 강사(강사는 수강 등록돼 있지 않아 따로 넣는다)")
                .containsExactlyInAnyOrderElementsOf(
                        java.util.stream.Stream.concat(f.studentIds.stream(), java.util.stream.Stream.of(f.instructorId)).toList());
    }

    /**
     * <b>때를 놓쳤으면 보내지 않는다.</b> 배포·장애로 폴링이 멈춘 사이 시작 시각까지 지나갔다면
     * "곧 시작합니다"는 거짓이다. 다만 행은 끝난 것으로 표시한다 — 매 주기 다시 집으면 안 된다.
     */
    @Test
    void a_missed_window_is_skipped_rather_than_lying() {
        Fixture f = fixture(1);
        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, OffsetDateTime.now().plusHours(2))
                .sessionId();
        // 폴링이 멈춘 사이 시작 시각이 지나갔다.
        jdbc.update("""
                UPDATE core.notification_schedule
                SET starts_at = now() - interval '5 minutes', fire_at = now() - interval '15 minutes'
                WHERE live_session_id = ?
                """, sessionId);

        scheduler.fireDue();

        assertThat(fanoutPayloadsFor(sessionId, "LIVE_STARTING_SOON")).isEmpty();
        assertThat(schedulesOf(sessionId))
                .as("보내지 않았어도 끝난 것으로 표시해야 매 주기 다시 집지 않는다")
                .allSatisfy(row -> assertThat(row.getFiredAt()).isNotNull());
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

    /**
     * <b>강사도 받아야 한다.</b> 팬아웃 SQL은 {@code core.enrollment}만 훑는데 강사는 자기
     * 커리큘럼에 수강 등록돼 있지 않아 그 집합에 없다 — 운영에서 수강생 넷은 받고 강사만 못 받는
     * 일이 실제로 있었다(2026-08-04, 세션 5ce856ea).
     */
    @Test
    void the_instructor_is_reminded_too_even_though_they_are_not_enrolled() {
        Fixture f = fixture(2);
        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, OffsetDateTime.now().plusMinutes(9))
                .sessionId();

        scheduler.fireDue();
        fanoutPayloadsFor(sessionId, "LIVE_STARTING_SOON").forEach(p -> worker.handle(p.toString()));

        assertThat(recipientsOf(f.curriculumId, "LIVE_STARTING_SOON"))
                .as("수강생 전원 + 강사")
                .contains(f.instructorId)
                .containsAll(f.studentIds);
    }

    /** 나머지 라이브 알림은 강사가 방금 자기가 한 일이라 보내지 않는다. */
    @Test
    void the_instructor_is_not_told_about_their_own_scheduling() {
        Fixture f = fixture(1);
        UUID sessionId = liveSessionManagement
                .create(f.lessonId, f.curriculumId, f.instructorId, OffsetDateTime.now().plusHours(2))
                .sessionId();

        fanoutPayloadsFor(sessionId, "LIVE_SCHEDULED").forEach(p -> worker.handle(p.toString()));

        assertThat(recipientsOf(f.curriculumId, "LIVE_SCHEDULED")).doesNotContain(f.instructorId);
    }

    // ---- helpers ----

    private record Fixture(UUID instructorId, List<UUID> studentIds, UUID curriculumId, UUID lessonId) {
    }

    private static org.assertj.core.data.TemporalUnitOffset within1Second() {
        return new org.assertj.core.data.TemporalUnitWithinOffset(
                1, java.time.temporal.ChronoUnit.SECONDS);
    }

    private Fixture fixture(int students) {
        UUID instructorId = seedUser("INSTRUCTOR");
        UUID curriculumId = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.curriculum (id, instructor_id, title, lifecycle_status)
                VALUES (?, ?, ?, 'PUBLISHED')
                """, curriculumId, instructorId, "곧 시작 커리큘럼");
        UUID sectionId = UUID.randomUUID();
        jdbc.update("INSERT INTO core.section (id, curriculum_id, title, order_index) VALUES (?, ?, ?, 0)",
                sectionId, curriculumId, "섹션");
        UUID lessonId = UUID.randomUUID();
        jdbc.update("INSERT INTO core.lesson (id, section_id, title, order_index) VALUES (?, ?, ?, 0)",
                lessonId, sectionId, "곧 시작 강의");
        List<UUID> studentIds = new java.util.ArrayList<>();
        for (int i = 0; i < students; i++) {
            UUID studentId = seedUser("STUDENT");
            jdbc.update("""
                    INSERT INTO core.enrollment (id, curriculum_id, user_id, status, requested_at)
                    VALUES (?, ?, ?, 'ACTIVE', now())
                    """, UUID.randomUUID(), curriculumId, studentId);
            studentIds.add(studentId);
        }
        return new Fixture(instructorId, studentIds, curriculumId, lessonId);
    }

    private UUID seedUser(String role) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role, status)
                VALUES (?, ?, 'x', ?, ?, 'ACTIVE')
                """, id, "soon-" + id + "@liveclass.test", "테스터", role);
        return id;
    }

    private List<NotificationSchedule> schedulesOf(UUID sessionId) {
        return scheduleRepository.findAll().stream()
                .filter(s -> sessionId.equals(s.getLiveSessionId()))
                .toList();
    }

    private List<JsonNode> fanoutPayloadsFor(UUID sessionId, String type) {
        return outboxEventRepository.findAll().stream()
                .filter(e -> NotificationMessagingConfig.FANOUT_QUEUE.equals(e.getDestination()))
                .filter(e -> sessionId.toString().equals(e.getAggregateId()))
                .map(OutboxEvent::getPayloadJson)
                .map(jsonMapper::readTree)
                .filter(p -> type.equals(p.get("type").asString()))
                .toList();
    }

    // 문구·targets는 사건당 한 행(content)으로 갔다(ADR-0123). 검증 내용은 그대로고 읽는 곳만 조인이다.
    private List<UUID> recipientsOf(UUID curriculumId, String type) {
        return jdbc.queryForList("""
                SELECT n.recipient_id
                FROM core.notification n
                JOIN core.notification_content c ON c.id = n.content_id
                WHERE c.targets->>'curriculumId' = ? AND c.type = ?
                """, UUID.class, curriculumId.toString(), type);
    }

    /**
     * 구간 분할을 걷어낸 <b>사건</b> 목록. 넓은 팬아웃은 사건 하나를 uuid 구간 수만큼의 명령으로
     * 낸다(ADR-0130) — 이 테스트가 세려는 것은 명령 수가 아니라 사건 수다.
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
}
