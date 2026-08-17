package com.liveclass.notification;

import com.liveclass.notification.config.NotificationMessagingConfig;
import com.liveclass.notification.push.PushDeliveryCommand;
import com.liveclass.notification.push.PushDeliveryWorker;
import com.liveclass.notification.push.PushProgressPartitionJob;
import com.liveclass.notification.push.WebPushSender;
import com.liveclass.notification.service.NotificationFanoutWorker;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;
import tools.jackson.databind.json.JsonMapper;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 푸시 전달 큐 + 진행 표(ADR-0124).
 *
 * <p>지키려는 것은 넷이다 — <b>푸시 명령이 알림 행과 함께 커밋되거나 함께 사라지는가</b>(아웃박스
 * 원자성: 커밋~발송 사이 크래시로 조각 전원의 푸시가 유실되던 구멍이 이걸로 닫힌다), <b>같은 명령이
 * 다시 와도 이미 시도를 마친 사람은 빠지는가</b>(진행 표 anti-join), <b>미완(batch-timeout으로
 * 버려진) 수신자는 기록되지 않아 재배달이 다시 집는가</b>, <b>진행 표 파티션 잡이 멱등하고 대상만
 * 지우는가</b>.
 *
 * <p>{@code @Transactional}을 쓰지 않는다 — 아웃박스 원자성은 롤백/커밋의 <b>차이</b>가 검증
 * 대상이라 트랜잭션을 직접 연다. 남긴 행은 직접 치운다.
 *
 * <p>{@code WebPushSender}는 목이다. 기기 단위 물결·미완 판정("시도를 마쳤다"의 경계)은
 * {@code WebPushRetryTest}가 실제 HTTP로 검증하고, 여기서는 그 반환값(시도를 마친 사람들)이
 * 진행 표와 어떻게 맞물리는지를 본다.
 */
@SpringBootTest
class PushDeliveryContractTest {

    @Autowired private NotificationFanoutWorker fanoutWorker;
    @Autowired private PushDeliveryWorker pushWorker;
    @Autowired private PushProgressPartitionJob partitionJob;
    @Autowired private com.liveclass.notification.push.PushSubscriptionRepository subscriptionRepository;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private PlatformTransactionManager transactionManager;

    /** 브로커가 없다. 워커의 다음 조각 발행은 이 테스트의 관심사가 아니다. */
    @MockitoBean private RabbitTemplate rabbitTemplate;
    @MockitoBean private WebPushSender pushSender;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private static final DateTimeFormatter DAY = DateTimeFormatter.BASIC_ISO_DATE;

    private UUID curriculumId;
    private UUID materialId;
    private List<UUID> students;

    @BeforeEach
    void setUp() {
        curriculumId = seedCurriculum();
        materialId = UUID.randomUUID();
        students = seedActiveStudents(3);
    }

    @AfterEach
    void cleanUpCommittedRows() {
        jdbc.update("DELETE FROM core.outbox_events WHERE destination IN (?, ?)",
                NotificationMessagingConfig.FANOUT_QUEUE, NotificationMessagingConfig.PUSH_QUEUE);
        // targets는 사건당 한 행(content)으로 갔다(ADR-0123). 지우는 대상은 그대로고 찾는 곳만 조인이다.
        jdbc.update("""
                DELETE FROM core.notification n
                 USING core.notification_content c
                 WHERE c.id = n.content_id AND c.targets->>'curriculumId' = ?
                """, curriculumId.toString());
        jdbc.update("DELETE FROM core.enrollment WHERE curriculum_id = ?", curriculumId);
        jdbc.update("DELETE FROM core.notification_preference WHERE curriculum_id = ?", curriculumId);
        jdbc.update("DELETE FROM core.lesson WHERE section_id IN (SELECT id FROM core.section WHERE curriculum_id = ?)",
                curriculumId);
        jdbc.update("DELETE FROM core.section WHERE curriculum_id = ?", curriculumId);
        jdbc.update("DELETE FROM core.curriculum WHERE id = ?", curriculumId);
        jdbc.update("DELETE FROM core.app_user WHERE email LIKE 'pushq-%'");
        // 진행 표는 UNLOGGED 보조 표라 FK가 없다. 이 스위트만 쓰므로 통째로 비워도 안전하다.
        jdbc.update("DELETE FROM core.notification_push_progress");
    }

    // ---- 아웃박스 원자성 ----

    /**
     * <b>업무가 롤백되면 푸시 명령도 없다.</b> 커밋 후 직접 발행이었다면 이 검증 자체가 불가능하다 —
     * 명령이 트랜잭션 밖에 있기 때문이다. 아웃박스라서 알림 행과 운명을 같이한다.
     */
    @Test
    void a_rolled_back_slice_leaves_no_push_command() {
        inTx(status -> {
            fanoutWorker.handle(materialCommandJson());
            status.setRollbackOnly();
        });

        assertThat(pushCommandPayloads()).isEmpty();
        assertThat(notificationCount()).as("알림 행도 함께 사라졌다 — 같은 트랜잭션의 증거").isZero();
    }

    /** 커밋되면 명령이 반드시 있고, 명단은 그 조각에서 새로 받은 전원이다. */
    @Test
    void a_committed_slice_ships_one_push_command_with_the_full_roster() {
        inTx(status -> fanoutWorker.handle(materialCommandJson()));

        List<String> payloads = pushCommandPayloads();
        assertThat(payloads).hasSize(1);
        PushDeliveryCommand command = jsonMapper.readValue(payloads.getFirst(), PushDeliveryCommand.class);
        assertThat(command.recipientIds()).containsExactlyInAnyOrderElementsOf(students);
        assertThat(command.type()).isEqualTo("MATERIAL_PUBLISHED");
        assertThat(command.title()).as("소비자가 알림 행을 도로 읽지 않도록 문구를 싣는다").isNotBlank();
        assertThat(command.body()).isNotBlank();
    }

    /**
     * <b>커밋 뒤 크래시 시나리오.</b> 같은 조각이 재배달되면 삽입은 0건이고 명단이 비어서 돌아오지만,
     * 푸시 명령은 첫 커밋에 이미 원자적으로 실려 있다 — 새로 실리지도, 사라지지도 않는다.
     * (분리 전에는 이 재배달에서 조각 전원의 푸시가 통째로 유실됐다.)
     */
    @Test
    void a_redelivered_slice_neither_duplicates_nor_loses_the_push_command() {
        String slice = materialCommandJson();
        inTx(status -> fanoutWorker.handle(slice));
        inTx(status -> fanoutWorker.handle(slice));

        List<String> payloads = pushCommandPayloads();
        assertThat(payloads).hasSize(1);
        assertThat(jsonMapper.readValue(payloads.getFirst(), PushDeliveryCommand.class).recipientIds())
                .as("명령의 명단은 첫 커밋의 전원 그대로다")
                .containsExactlyInAnyOrderElementsOf(students);
    }

    /**
     * <b>같은 회차의 리드타임 발화들은 사건 해시를 공유하지만, 푸시 명령은 각자 실려야 한다.</b>
     * 곧 시작 알림의 dedupe 키에는 리드타임이 없으므로(팬아웃 워커의 dedupePrefix 주석) 30분 전
     * 발화와 10분 전 발화가 같은 해시가 된다 — 멱등 키가 그것뿐이면 뒤 발화(대개 기본값 10분,
     * 즉 대다수)의 명령이 아웃박스 멱등에 조용히 삼켜진다.
     */
    @Test
    void two_lead_time_firings_of_the_same_session_each_ship_their_own_push_command() {
        UUID lessonId = seedLesson();
        UUID liveSessionId = UUID.randomUUID();   // 세션 조회는 실패해도 된다 — 커리큘럼을 싣고 간다
        java.time.OffsetDateTime startsAt = java.time.OffsetDateTime.now().plusHours(1);
        UUID thirtyMinutePerson = students.getFirst();
        jdbc.update("""
                INSERT INTO core.notification_preference (id, user_id, curriculum_id, lesson_id, enabled, lead_minutes)
                VALUES (?, ?, ?, NULL, true, 30)
                """, UUID.randomUUID(), thirtyMinutePerson, curriculumId);

        inTx(status -> fanoutWorker.handle(startingSoonJson(liveSessionId, lessonId, startsAt, 30)));
        inTx(status -> fanoutWorker.handle(startingSoonJson(liveSessionId, lessonId, startsAt, 10)));

        UUID eventHash = PushDeliveryCommand.eventHashOf("LIVE_STARTING_SOON:" + liveSessionId
                + ':' + startsAt.toInstant().toEpochMilli() + ':');
        List<PushDeliveryCommand> commands = jdbc.queryForList("""
                        SELECT payload_json FROM core.outbox_events
                        WHERE destination = ? AND payload_json::text LIKE ?
                        """, String.class, NotificationMessagingConfig.PUSH_QUEUE, "%" + eventHash + "%")
                .stream()
                .map(payload -> jsonMapper.readValue(payload, PushDeliveryCommand.class))
                .toList();
        assertThat(commands).as("발화마다 명령 하나 — 뒤 발화가 삼켜지면 안 된다").hasSize(2);
        assertThat(commands.stream().flatMap(c -> c.recipientIds().stream()))
                .as("두 발화의 명단을 합치면 전원이고 겹침이 없다")
                .containsExactlyInAnyOrderElementsOf(students);
    }

    // ---- 진행 표 anti-join ----

    /** 같은 명령이 다시 오면(기록 후 ack 전에 죽음) 전원이 걸러져 발송이 아예 없다. */
    @Test
    void a_redelivered_push_command_skips_recipients_already_settled() {
        UUID event = UUID.randomUUID();
        List<UUID> recipients = List.of(UUID.randomUUID(), UUID.randomUUID(), UUID.randomUUID());
        when(pushSender.send(any(), any(), any(), any()))
                .thenAnswer(invocation -> new WebPushSender.SendResult(
                        Set.copyOf(invocation.<Collection<UUID>>getArgument(0)), Set.of(), null));
        String command = pushCommandJson(event, recipients);

        pushWorker.handle(command);
        pushWorker.handle(command);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<UUID>> sent = ArgumentCaptor.forClass(Collection.class);
        verify(pushSender, times(1)).send(sent.capture(), any(), any(), any());
        assertThat(sent.getValue()).containsExactlyInAnyOrderElementsOf(recipients);
    }

    /**
     * <b>미완은 기록되지 않는다.</b> batch-timeout으로 버려진 수신자는 반환값에 없으므로 진행 표에
     * 안 적히고, 재배달이 <b>그 사람만</b> 다시 집는다. 전원이 끝난 뒤의 재배달은 발송 없이 끝난다.
     */
    @Test
    void an_unfinished_recipient_is_picked_up_again_on_redelivery() {
        UUID event = UUID.randomUUID();
        UUID done = UUID.randomUUID();
        UUID alsoDone = UUID.randomUUID();
        UUID abandoned = UUID.randomUUID();
        when(pushSender.send(any(), any(), any(), any()))
                // 첫 배달 — abandoned는 마감에 걸려 미완. 미완인 사람은 기록되지 않는다.
                .thenReturn(new WebPushSender.SendResult(Set.of(done, alsoDone), Set.of(abandoned), null))
                .thenAnswer(invocation -> new WebPushSender.SendResult(
                        Set.copyOf(invocation.<Collection<UUID>>getArgument(0)), Set.of(), null));
        String command = pushCommandJson(event, List.of(done, alsoDone, abandoned));

        pushWorker.handle(command);
        pushWorker.handle(command);
        pushWorker.handle(command);   // 전원 완료 — 발송이 없어야 한다

        @SuppressWarnings("unchecked")
        ArgumentCaptor<Collection<UUID>> sent = ArgumentCaptor.forClass(Collection.class);
        verify(pushSender, times(2)).send(sent.capture(), any(), any(), any());
        assertThat(sent.getAllValues().get(1))
                .as("재배달은 미완이었던 사람만 다시 집는다 — 이미 받은 둘이 또 울리면 안 된다")
                .containsExactly(abandoned);
    }

    /**
     * 결과 반영의 벌크 두 문장이 <b>진짜 DB에서 도는가</b>. 이 두 쿼리는 발송 결과 반영 경로에서만
     * 쓰여서, 목 리포지토리로 도는 {@code WebPushRetryTest}는 호출 여부만 보고 문법은 영영 검증하지
     * 못한다 — 컨텍스트 기동은 파싱만 하고 실행은 여기서 처음이다.
     */
    @Test
    void bulk_outcome_updates_actually_run_against_the_database() {
        UUID owner = seedUser("STUDENT");
        UUID dead = insertSubscription(owner);
        UUID alive = insertSubscription(owner);

        inTx(status -> {
            subscriptionRepository.deleteAllByIds(List.of(dead));
            subscriptionRepository.markDelivered(List.of(alive), java.time.OffsetDateTime.now());
        });

        assertThat(jdbc.queryForObject("SELECT count(*) FROM core.push_subscription WHERE id = ?",
                Integer.class, dead)).isZero();
        assertThat(jdbc.queryForObject("SELECT last_success_at FROM core.push_subscription WHERE id = ?",
                java.time.OffsetDateTime.class, alive)).isNotNull();
    }

    // ---- 진행 표 파티션 잡 ----

    /** 선생성은 멱등이다 — 겹쳐 돌아도, 이미 있어도(마이그레이션이 만든 오늘치) 같은 결과다. */
    @Test
    void the_partition_job_precreates_idempotently() {
        partitionJob.maintain();
        List<String> first = dayPartitions();

        partitionJob.maintain();

        assertThat(dayPartitions()).containsExactlyElementsOf(first);
        LocalDate today = LocalDate.now(ZoneOffset.UTC);
        assertThat(first)
                .contains(partitionName(today), partitionName(today.plusDays(14)));
    }

    /** DROP은 이름의 날짜가 보존 기간을 지난 파티션만 지운다. 오늘치와 DEFAULT는 절대 안 지운다. */
    @Test
    void the_partition_job_drops_only_expired_partitions() {
        LocalDate expired = LocalDate.now(ZoneOffset.UTC).minusDays(10);
        createPartition(expired);

        partitionJob.maintain();

        assertThat(dayPartitions())
                .doesNotContain(partitionName(expired))
                .contains(partitionName(LocalDate.now(ZoneOffset.UTC)));
        assertThat(defaultPartitionExists()).as("에어백은 남는다").isTrue();
    }

    /** DEFAULT에 떨어진 행(선생성이 밀렸던 흔적)이 있어도 잡은 던지지 않는다 — WARN으로만 알린다. */
    @Test
    void rows_stranded_in_the_default_partition_do_not_break_the_job() {
        jdbc.update("""
                INSERT INTO core.notification_push_progress (event_hash, recipient_id, settled_at)
                VALUES (?, ?, CAST('2020-01-01 00:00:00+00' AS timestamptz))
                """, UUID.randomUUID(), UUID.randomUUID());

        partitionJob.maintain();

        assertThat(defaultPartitionExists()).isTrue();
    }

    // ---- helpers ----

    private void inTx(java.util.function.Consumer<org.springframework.transaction.TransactionStatus> work) {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        tx.executeWithoutResult(work::accept);
    }

    private String materialCommandJson() {
        return """
                {"type":"MATERIAL_PUBLISHED","curriculumId":"%s","curriculumTitle":"푸시 큐 커리큘럼",
                 "materialId":"%s","lessonId":null,"subjectName":"자료.pptx",
                 "afterUserId":null,"sliceLimit":100}
                """.formatted(curriculumId, materialId);
    }

    /**
     * 곧 시작 발화 조각. {@code NotificationFanoutCommand}는 서비스 패키지의 공개 record라 직접
     * 조립해 직렬화한다 — 스케줄러가 싣는 모양과 같다(커리큘럼은 채워져 있고 강사는 비어 있다).
     */
    private String startingSoonJson(UUID liveSessionId, UUID lessonId,
                                    java.time.OffsetDateTime startsAt, int leadMinutes) {
        return jsonMapper.writeValueAsString(new com.liveclass.notification.service.NotificationFanoutCommand(
                "LIVE_STARTING_SOON", null, curriculumId, "푸시 큐 커리큘럼", null, null,
                lessonId, null, null, null, null, null, 100, liveSessionId, null, leadMinutes, null, startsAt));
    }

    private UUID seedLesson() {
        UUID sectionId = UUID.randomUUID();
        jdbc.update("INSERT INTO core.section (id, curriculum_id, title, order_index) VALUES (?, ?, ?, 0)",
                sectionId, curriculumId, "섹션");
        UUID lessonId = UUID.randomUUID();
        jdbc.update("INSERT INTO core.lesson (id, section_id, title, order_index) VALUES (?, ?, ?, 0)",
                lessonId, sectionId, "강의");
        return lessonId;
    }

    private String pushCommandJson(UUID eventHash, List<UUID> recipients) {
        return jsonMapper.writeValueAsString(
                new PushDeliveryCommand("MATERIAL_PUBLISHED", eventHash, recipients, "제목", "본문", null, 1));
    }

    /** 이 테스트의 사건(materialId) 것만 고른다 — 아웃박스는 스위트가 공유한다. */
    private List<String> pushCommandPayloads() {
        UUID eventHash = PushDeliveryCommand.eventHashOf("MATERIAL_PUBLISHED:" + materialId + ':');
        return jdbc.queryForList("""
                SELECT payload_json FROM core.outbox_events
                WHERE destination = ? AND payload_json::text LIKE ?
                """, String.class, NotificationMessagingConfig.PUSH_QUEUE, "%" + eventHash + "%");
    }

    private int notificationCount() {
        Integer count = jdbc.queryForObject("""
                SELECT count(*)
                FROM core.notification n
                JOIN core.notification_content c ON c.id = n.content_id
                WHERE c.targets->>'curriculumId' = ?
                """, Integer.class, curriculumId.toString());
        return count == null ? 0 : count;
    }

    private static String partitionName(LocalDate day) {
        return "notification_push_progress_p" + DAY.format(day);
    }

    /** 잡과 같은 모양의 파티션을 과거 날짜로 만들어 DROP 대상을 흉내 낸다. */
    private void createPartition(LocalDate day) {
        jdbc.execute(("CREATE UNLOGGED TABLE IF NOT EXISTS core.%s "
                + "PARTITION OF core.notification_push_progress "
                + "FOR VALUES FROM ('%s 00:00:00+00') TO ('%s 00:00:00+00')")
                .formatted(partitionName(day), day, day.plusDays(1)));
    }

    private List<String> dayPartitions() {
        return jdbc.queryForList("""
                SELECT c.relname
                FROM pg_inherits i
                JOIN pg_class c ON c.oid = i.inhrelid
                JOIN pg_class parent ON parent.oid = i.inhparent
                JOIN pg_namespace n ON n.oid = parent.relnamespace
                WHERE n.nspname = 'core' AND parent.relname = 'notification_push_progress'
                ORDER BY c.relname
                """, String.class);
    }

    private boolean defaultPartitionExists() {
        Boolean exists = jdbc.queryForObject("""
                SELECT EXISTS (SELECT 1 FROM pg_class c
                               JOIN pg_namespace n ON n.oid = c.relnamespace
                               WHERE n.nspname = 'core'
                                 AND c.relname = 'notification_push_progress_default')
                """, Boolean.class);
        return Boolean.TRUE.equals(exists);
    }

    private List<UUID> seedActiveStudents(int count) {
        List<UUID> ids = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            UUID userId = seedUser("STUDENT");
            jdbc.update("""
                    INSERT INTO core.enrollment (id, curriculum_id, user_id, status, requested_at)
                    VALUES (?, ?, ?, 'ACTIVE', now())
                    """, UUID.randomUUID(), curriculumId, userId);
            ids.add(userId);
        }
        return ids;
    }

    private UUID seedCurriculum() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.curriculum (id, instructor_id, title, lifecycle_status)
                VALUES (?, ?, ?, 'PUBLISHED')
                """, id, seedUser("INSTRUCTOR"), "푸시 큐 커리큘럼");
        return id;
    }

    /** 구독 행. app_user 삭제에 CASCADE라(V27) 사용자 정리가 함께 치운다. */
    private UUID insertSubscription(UUID userId) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.push_subscription (id, user_id, endpoint, p256dh, auth)
                VALUES (?, ?, ?, 'k', 'a')
                """, id, userId, "https://push.example/pushq-" + id);
        return id;
    }

    private UUID seedUser(String role) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role, status)
                VALUES (?, ?, 'x', ?, ?, 'ACTIVE')
                """, id, "pushq-" + id + "@liveclass.test", "테스터", role);
        return id;
    }
}
