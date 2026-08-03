package com.liveclass.notification.service;

import com.liveclass.aiintegration.api.OutboxPublisher;
import com.liveclass.enrollment.api.EnrollmentDecidedEvent;
import com.liveclass.enrollment.api.EnrollmentRequestedEvent;
import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.config.NotificationMessagingConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;

/**
 * 수강 사건을 듣고 팬아웃 요청을 <b>아웃박스에 한 줄</b> 싣는다(ADR-0073 §1·§3).
 *
 * <p><b>왜 BEFORE_COMMIT인가.</b> 아웃박스의 존재 이유는 업무 변경과 메시지 기록이 같은 트랜잭션에
 * 들어가는 것이다. AFTER_COMMIT으로 들으면 커밋과 아웃박스 삽입 사이에 프로세스가 죽었을 때
 * 승인은 됐는데 알림은 영영 오지 않는다 — 아웃박스를 쓰는 의미가 사라진다.
 *
 * <p><b>여기서 하는 일은 INSERT 한 줄뿐이다.</b> 문구 만들기·수신자 조회·대량 삽입처럼 터질 수 있는
 * 일은 전부 워커에서 한다. 이 리스너가 예외를 던지면 수강 승인이 통째로 롤백되기 때문이다.
 */
@Component
public class EnrollmentNotificationListener {

    private static final Logger log = LoggerFactory.getLogger(EnrollmentNotificationListener.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final OutboxPublisher outboxPublisher;

    public EnrollmentNotificationListener(OutboxPublisher outboxPublisher) {
        this.outboxPublisher = outboxPublisher;
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void onRequested(EnrollmentRequestedEvent event) {
        enqueue(new NotificationFanoutCommand(
                NotificationTypes.ENROLLMENT_REQUESTED,
                event.enrollmentId(), event.curriculumId(), event.curriculumTitle(),
                event.instructorId(), event.studentId(), event.occurredAt()));
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void onDecided(EnrollmentDecidedEvent event) {
        enqueue(new NotificationFanoutCommand(
                event.approved() ? NotificationTypes.ENROLLMENT_APPROVED : NotificationTypes.ENROLLMENT_REJECTED,
                event.enrollmentId(), event.curriculumId(), event.curriculumTitle(),
                event.instructorId(), event.studentId(), event.occurredAt()));
    }

    private void enqueue(NotificationFanoutCommand command) {
        outboxPublisher.enqueue(
                NotificationMessagingConfig.FANOUT_QUEUE,
                "enrollment",
                command.enrollmentId().toString(),
                "NOTIFICATION_FANOUT_REQUESTED",
                JSON.writeValueAsString(command),
                idempotencyKey(command),
                null);
        log.debug("알림 팬아웃 요청 적재 type={} enrollment={}", command.type(), command.enrollmentId());
    }

    /**
     * 아웃박스 중복 방지 키. <b>사건 시각을 넣는다</b> — 거절된 학생이 다시 신청하면 같은 수강 행이
     * 되살아나므로(EnrollmentService.apply), 시각이 없으면 두 번째 신청이 첫 번째와 같은 키가 되어
     * 조용히 사라진다.
     */
    private static String idempotencyKey(NotificationFanoutCommand command) {
        OffsetDateTime at = command.occurredAt();
        return "notif:" + command.type() + ':' + command.enrollmentId()
                + ':' + (at == null ? "0" : at.toInstant().toEpochMilli());
    }
}
