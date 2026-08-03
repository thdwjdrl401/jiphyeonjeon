package com.liveclass.notification;

import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.domain.NotificationStatus;
import com.liveclass.notification.repository.NotificationFanoutRepository;
import com.liveclass.notification.repository.NotificationFanoutRepository.Slice;
import com.liveclass.notification.web.ws.NotificationSignalPayload;
import com.liveclass.notification.web.ws.WsNotificationBroadcaster;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.messaging.simp.user.SimpUser;
import org.springframework.messaging.simp.user.SimpUserRegistry;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 실시간 알림 전달(ADR-0073 5단계).
 *
 * <p>지키려는 것은 넷이다 — <b>개인 목적지로 가는가</b>(남이 구독할 수 없는), <b>접속한 사람에게만
 * 보내는가</b>, <b>새로 받은 사람에게만 보내는가</b>(중복은 조용히), <b>한 명이 실패해도 나머지는
 * 가는가</b>.
 *
 * <p>마지막이 중요하다. 실시간 전달은 <b>거들 뿐</b>이고 알림 자체는 이미 저장돼 있다 — 여기서
 * 예외가 올라가면 워커가 조각 전체를 재시도한다.
 */
@SpringBootTest
@Transactional
class NotificationRealtimeContractTest {

    @Autowired private WsNotificationBroadcaster broadcaster;
    @Autowired private NotificationFanoutRepository fanoutRepository;
    @Autowired private JdbcTemplate jdbc;

    @MockitoBean private SimpMessagingTemplate messagingTemplate;
    @MockitoBean private SimpUserRegistry userRegistry;

    private UUID curriculumId;

    @BeforeEach
    void setUp() {
        curriculumId = seedCurriculum();
    }

    /**
     * 목적지가 {@code /queue/notifications}다. Spring이 이걸 세션의 Principal로 해석하므로
     * <b>남의 알림을 구독할 방법이 없다</b> — 토픽이었다면 구독 인가 목록에 줄을 더해야 한다.
     */
    @Test
    void a_connected_user_gets_a_signal_on_their_own_destination() {
        UUID recipient = UUID.randomUUID();
        connect(recipient);

        broadcaster.announce(recipient, NotificationTypes.ENROLLMENT_APPROVED);

        ArgumentCaptor<Object> body = ArgumentCaptor.forClass(Object.class);
        verify(messagingTemplate).convertAndSendToUser(
                eq(recipient.toString()), eq("/queue/notifications"), body.capture());
        assertThat(body.getValue()).isInstanceOf(NotificationSignalPayload.class);
        assertThat(((NotificationSignalPayload) body.getValue()).notificationType())
                .isEqualTo(NotificationTypes.ENROLLMENT_APPROVED);
    }

    /**
     * 접속해 있지 않으면 보내지 않는다. 보내도 브로커가 버리지만, 100만 명 팬아웃에서 그 호출을
     * 100만 번 하는 것과 접속자 수만큼 하는 것은 다르다.
     */
    @Test
    void an_offline_user_is_skipped_entirely() {
        broadcaster.announce(UUID.randomUUID(), NotificationTypes.MATERIAL_PUBLISHED);

        verify(messagingTemplate, never()).convertAndSendToUser(any(), any(), any(Object.class));
    }

    @Test
    void one_failure_does_not_stop_the_rest() {
        UUID failing = UUID.randomUUID();
        UUID healthy = UUID.randomUUID();
        connect(failing);
        connect(healthy);
        org.mockito.Mockito.doThrow(new IllegalStateException("broker down"))
                .when(messagingTemplate)
                .convertAndSendToUser(eq(failing.toString()), any(), any(Object.class));

        broadcaster.announceAll(List.of(failing, healthy), NotificationTypes.VOD_PUBLISHED);

        verify(messagingTemplate).convertAndSendToUser(eq(healthy.toString()), any(), any(Object.class));
    }

    /**
     * <b>새로 받은 사람만</b> 나온다. 재배달로 같은 조각을 다시 처리해도 이미 받은 사람은 빠지므로,
     * 화면에 알림이 두 번 뜨지 않는다.
     */
    @Test
    void a_replayed_slice_reports_no_new_recipients() {
        List<UUID> students = seedActiveStudents(3);

        Slice first = insertSlice();
        Slice replay = insertSlice();

        assertThat(first.insertedRecipients()).containsExactlyInAnyOrderElementsOf(students);
        assertThat(replay.insertedRecipients())
                .as("두 번째는 전부 중복이라 알릴 사람이 없다")
                .isEmpty();
    }

    // ---- helpers ----

    private void connect(UUID userId) {
        when(userRegistry.getUser(userId.toString())).thenReturn(mock(SimpUser.class));
    }

    private Slice insertSlice() {
        return fanoutRepository.insertForActiveStudents(
                curriculumId, null, 100,
                NotificationTypes.MATERIAL_PUBLISHED, NotificationStatus.INFO, NotificationStatus.NORMAL,
                "새 강의 자료", "«테스트»에 새 자료가 올라왔습니다.",
                "{\"curriculumId\":\"" + curriculumId + "\"}",
                NotificationTypes.MATERIAL_PUBLISHED + ':' + curriculumId,
                NotificationTypes.MATERIAL_PUBLISHED + ":rt-" + curriculumId + ':',
                null, null);
    }

    private List<UUID> seedActiveStudents(int count) {
        List<UUID> ids = new java.util.ArrayList<>();
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
                """, id, seedUser("INSTRUCTOR"), "실시간 알림 커리큘럼");
        return id;
    }

    private UUID seedUser(String role) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                INSERT INTO core.app_user (id, email, password_hash, display_name, role, status)
                VALUES (?, ?, 'x', ?, ?, 'ACTIVE')
                """, id, "rt-" + id + "@liveclass.test", "테스터", role);
        return id;
    }
}
