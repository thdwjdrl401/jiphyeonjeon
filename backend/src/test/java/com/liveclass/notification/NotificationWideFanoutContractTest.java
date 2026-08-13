package com.liveclass.notification;

import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.domain.NotificationStatus;
import com.liveclass.notification.repository.NotificationFanoutRepository;
import com.liveclass.notification.repository.NotificationFanoutRepository.Slice;
import com.liveclass.notification.config.NotificationMessagingConfig;
import com.liveclass.notification.service.NotificationFanoutWorker;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import org.mockito.ArgumentCaptor;

import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.ArgumentCaptor.forClass;

/**
 * 넓은 팬아웃의 커서 슬라이싱(ADR-0073 §5).
 *
 * <p>지키려는 것은 셋이다 — <b>조건에 맞는 사람에게만 가는가</b>, <b>조각을 이어 갈 때 건너뛰거나
 * 겹치는 사람이 없는가</b>, <b>더 있는지 판단이 삽입 수가 아니라 훑은 수에 걸려 있는가</b>.
 *
 * <p>마지막 하나가 미묘하다. 재시도로 그 조각이 전부 중복이면 삽입 수는 0인데 뒤에 수강생이 남아
 * 있을 수 있고, 삽입 수로 판단하면 <b>거기서 체인이 끊긴다</b>.
 *
 * <p>여기서는 리포지토리를 직접 부른다. 발행부터 태우려면 커밋이 필요해 수강생 수십 명을 실제
 * 계정으로 만들어야 하는데, 이 테스트가 보려는 것은 <b>SQL이 집합을 어떻게 자르는가</b>다.
 */
@SpringBootTest
@Transactional
class NotificationWideFanoutContractTest {

    @Autowired private NotificationFanoutRepository fanoutRepository;
    @Autowired private NotificationFanoutWorker worker;
    @Autowired private JdbcTemplate jdbc;

    /** 브로커가 없다. 워커가 <b>다음 조각을 실제로 발행하는지</b>만 보므로 목으로 충분하다. */
    @MockitoBean private RabbitTemplate rabbitTemplate;

    private UUID curriculumId;

    @BeforeEach
    void setUp() {
        curriculumId = seedCurriculum();
    }

    @Test
    void only_active_students_of_this_curriculum_receive_it() {
        List<UUID> active = seedEnrollments(curriculumId, "ACTIVE", 3);
        seedEnrollments(curriculumId, "PENDING", 2);
        seedEnrollments(curriculumId, "CANCELLED", 2);
        seedEnrollments(seedCurriculum(), "ACTIVE", 4);   // 다른 커리큘럼 수강생은 받지 않는다

        Slice slice = insert(null, 100);

        assertThat(slice.inserted()).isEqualTo(3);
        assertThat(recipients()).containsExactlyInAnyOrderElementsOf(active);
    }

    /**
     * 조각을 끝까지 이어 갔을 때 <b>전원이 정확히 한 번씩</b> 받아야 한다. 커서가 유일하고 변하지
     * 않는 값(user_id)이라야 건너뜀도 겹침도 생기지 않는다.
     */
    @Test
    void slicing_covers_everyone_exactly_once() {
        List<UUID> active = seedEnrollments(curriculumId, "ACTIVE", 25);

        int limit = 7;
        int rounds = 0;
        UUID cursor = null;
        int inserted = 0;
        while (true) {
            Slice slice = insert(cursor, limit);
            inserted += slice.inserted();
            rounds++;
            if (!slice.mayHaveMore(limit)) {
                break;
            }
            cursor = slice.lastUserId();
        }

        assertThat(rounds).as("7명씩 25명이면 4조각(7·7·7·4)").isEqualTo(4);
        assertThat(inserted).isEqualTo(25);
        assertThat(recipients())
                .as("건너뛴 사람도 두 번 받은 사람도 없다")
                .containsExactlyInAnyOrderElementsOf(active);
    }

    /**
     * 같은 조각을 다시 처리해도(재배달) 행이 늘지 않는다. 중복은 코드가 아니라 {@code dedupe_key}
     * 유니크 제약이 막는다.
     */
    @Test
    void replaying_a_slice_inserts_nothing_new() {
        seedEnrollments(curriculumId, "ACTIVE", 5);

        Slice first = insert(null, 100);
        Slice again = insert(null, 100);

        assertThat(first.inserted()).isEqualTo(5);
        assertThat(again.inserted()).as("두 번째는 전부 중복이라 0이다").isZero();
        assertThat(recipients()).hasSize(5);
    }

    /**
     * <b>재배달로 전부 중복이어도 체인은 이어져야 한다.</b> 더 있는지는 삽입 수가 아니라 훑은 수가
     * 답한다 — 삽입 수로 판단했다면 여기서 커서가 멈추고 뒤쪽 수강생은 영영 못 받는다.
     */
    @Test
    void a_fully_duplicated_slice_still_reports_more_to_come() {
        seedEnrollments(curriculumId, "ACTIVE", 10);
        int limit = 4;
        insert(null, limit);              // 첫 조각을 미리 넣어 둔다

        Slice replay = insert(null, limit);   // 같은 조각을 다시

        assertThat(replay.inserted()).isZero();
        assertThat(replay.scanned()).isEqualTo(limit);
        assertThat(replay.mayHaveMore(limit))
                .as("삽입이 0이어도 뒤에 남아 있으면 이어 가야 한다")
                .isTrue();
        assertThat(replay.lastUserId()).isNotNull();
    }

    @Test
    void an_empty_roster_ends_the_chain_immediately() {
        Slice slice = insert(null, 100);

        assertThat(slice.scanned()).isZero();
        assertThat(slice.inserted()).isZero();
        assertThat(slice.lastUserId()).isNull();
        assertThat(slice.mayHaveMore(100)).isFalse();
    }

    /**
     * <b>워커가 자기 다음 조각을 큐에 넣는다</b>(ADR-0073 §5). 몇 조각인지 미리 세지 않으므로
     * 100만 행에 COUNT(*)를 돌릴 일이 없고, 큐 길이가 워커 속도에 맞춰 저절로 조절된다.
     */
    @Test
    void the_worker_enqueues_its_own_next_slice_while_more_remain() {
        seedEnrollments(curriculumId, "ACTIVE", 5);

        worker.handle(materialCommandJson(null, 2));

        ArgumentCaptor<Object> body = forClass(Object.class);
        verify(rabbitTemplate).convertAndSend(eq(NotificationMessagingConfig.FANOUT_QUEUE), body.capture());
        assertThat(String.valueOf(body.getValue()))
                .as("다음 조각은 커서가 채워진 같은 사건이다")
                .contains("\"afterUserId\"").contains("MATERIAL_PUBLISHED");
    }

    /** 마지막 조각에서는 아무것도 더 넣지 않는다 — 넣으면 빈 조각이 영원히 돈다. */
    @Test
    void the_worker_stops_when_the_roster_is_exhausted() {
        seedEnrollments(curriculumId, "ACTIVE", 2);

        worker.handle(materialCommandJson(null, 10));

        verify(rabbitTemplate, never()).convertAndSend(eq(NotificationMessagingConfig.FANOUT_QUEUE), (Object) org.mockito.ArgumentMatchers.any());
        assertThat(recipients()).hasSize(2);
    }

    // ---- helpers ----

    private String materialCommandJson(UUID afterUserId, int sliceLimit) {
        return """
                {"type":"MATERIAL_PUBLISHED","curriculumId":"%s","curriculumTitle":"테스트 커리큘럼",
                 "materialId":"%s","lessonId":null,"subjectName":"자료.pptx",
                 "afterUserId":%s,"sliceLimit":%d}
                """.formatted(curriculumId, UUID.nameUUIDFromBytes(("mat" + curriculumId).getBytes()),
                afterUserId == null ? "null" : "\"" + afterUserId + "\"", sliceLimit);
    }

    private Slice insert(UUID afterUserId, int limit) {
        return fanoutRepository.insertForActiveStudents(
                curriculumId, afterUserId, limit,
                NotificationTypes.MATERIAL_PUBLISHED, NotificationStatus.INFO, NotificationStatus.NORMAL,
                "새 강의 자료", "«테스트»에 새 자료가 올라왔습니다.",
                "{\"curriculumId\":\"" + curriculumId + "\"}",
                NotificationTypes.MATERIAL_PUBLISHED + ':' + curriculumId,
                NotificationTypes.MATERIAL_PUBLISHED + ":mat-" + curriculumId + ':',
                null, null);   // 일정 두 칸은 라이브 알림 전용이다
    }

    /**
     * 수강 행을 SQL로 직접 넣는다 — 이 테스트가 보는 것은 <b>집합을 자르는 SQL</b>이지 회원가입·
     * 신청 경로가 아니다. 다만 외래 키가 실재하는 커리큘럼·사용자를 요구하므로 그것들도 함께 만든다.
     */
    private List<UUID> seedEnrollments(UUID curriculum, String status, int count) {
        List<UUID> userIds = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            UUID userId = seedUser("STUDENT");
            jdbc.update("""
                    INSERT INTO core.enrollment (id, curriculum_id, user_id, status, requested_at)
                    VALUES (?, ?, ?, ?, now())
                    """, UUID.randomUUID(), curriculum, userId, status);
            userIds.add(userId);
        }
        return userIds;
    }

    private UUID seedCurriculum() {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.curriculum (id, instructor_id, title, lifecycle_status)
                VALUES (?, ?, ?, 'PUBLISHED')
                """, id, seedUser("INSTRUCTOR"), "팬아웃 대상 커리큘럼");
        return id;
    }

    private UUID seedUser(String role) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role, status)
                VALUES (?, ?, 'x', ?, ?, 'ACTIVE')
                """, id, "wide-" + id + "@liveclass.test", "테스터", role);
        return id;
    }

    // targets는 사건당 한 행(content)으로 갔다(ADR-0123). 검증 내용은 그대로고 읽는 곳만 조인이다.
    private List<UUID> recipients() {
        return jdbc.queryForList("""
                SELECT n.recipient_id
                FROM core.notification n
                JOIN core.notification_content c ON c.id = n.content_id
                WHERE c.targets->>'curriculumId' = ?
                """, UUID.class, curriculumId.toString());
    }
}
