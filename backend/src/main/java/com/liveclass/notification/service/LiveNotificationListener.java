package com.liveclass.notification.service;

import com.liveclass.aiintegration.api.OutboxPublisher;
import com.liveclass.live.api.LiveScheduleEvent;
import com.liveclass.notification.api.NotificationTypes;
import com.liveclass.notification.config.NotificationMessagingConfig;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import tools.jackson.databind.json.JsonMapper;

/**
 * 라이브 일정 사건을 듣고 <b>넓은 팬아웃</b>의 첫 조각을 아웃박스에 싣는다.
 *
 * <p>세 종류가 한 리스너인 이유는 사건이 하나이기 때문이다 — 예정·변경·취소는 모두 "이 강의를 언제
 * 하는가"를 알리고, 받는 사람도 규칙도 같다.
 *
 * <p>{@code BEFORE_COMMIT}인 이유와 여기서 INSERT 한 줄만 하는 이유는
 * {@link EnrollmentNotificationListener}와 같다. 강의 제목조차 여기서 찾지 않는다.
 */
@Component
public class LiveNotificationListener {

    private static final Logger log = LoggerFactory.getLogger(LiveNotificationListener.class);
    private static final JsonMapper JSON = JsonMapper.builder().build();

    private final OutboxPublisher outboxPublisher;
    private final int sliceLimit;

    public LiveNotificationListener(OutboxPublisher outboxPublisher,
                                    @Value("${notification.fanout.slice-size:1000}") int sliceLimit) {
        this.outboxPublisher = outboxPublisher;
        this.sliceLimit = sliceLimit;
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void onSchedule(LiveScheduleEvent event) {
        String type = typeOf(event.kind());
        NotificationFanoutCommand command = NotificationFanoutCommand.forLiveSchedule(
                type, event.curriculumId(), event.lessonId(), event.sessionId(),
                event.previousStartsAt(), event.nextStartsAt(), event.occurredAt(), sliceLimit);

        outboxPublisher.enqueue(
                NotificationMessagingConfig.FANOUT_QUEUE,
                "live_session",
                event.sessionId().toString(),
                "NOTIFICATION_FANOUT_REQUESTED",
                JSON.writeValueAsString(command),
                idempotencyKey(type, event),
                null);
        log.debug("라이브 알림 팬아웃 요청 적재 type={} session={}", type, event.sessionId());
    }

    private static String typeOf(LiveScheduleEvent.Kind kind) {
        return switch (kind) {
            case SCHEDULED -> NotificationTypes.LIVE_SCHEDULED;
            case RESCHEDULED -> NotificationTypes.LIVE_SCHEDULE_CHANGED;
            case CANCELED -> NotificationTypes.LIVE_CANCELED;
        };
    }

    /**
     * <b>변경만 새 시각이 키에 들어간다.</b> 일정은 몇 번이고 바뀔 수 있는데, 세션 id까지만으로
     * 키를 만들면 두 번째 변경이 첫 번째에 묻혀 학생이 옛 시각을 그대로 믿는다. 예정·취소는
     * 세션당 한 번뿐이라 그럴 일이 없다.
     */
    private static String idempotencyKey(String type, LiveScheduleEvent event) {
        String base = "notif:" + type + ':' + event.sessionId();
        if (!NotificationTypes.LIVE_SCHEDULE_CHANGED.equals(type)) {
            return base;
        }
        long at = event.nextStartsAt() == null ? 0L : event.nextStartsAt().toInstant().toEpochMilli();
        return base + ':' + at;
    }
}
