package com.liveclass.notification.service;

import com.liveclass.live.api.LiveScheduleEvent;
import com.liveclass.notification.domain.NotificationSchedule;
import com.liveclass.notification.repository.NotificationScheduleRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

import java.time.OffsetDateTime;

/**
 * 라이브 일정에 맞춰 발화 예정을 잡고, 옮기고, 지운다(ADR-0073 §6).
 *
 * <p>같은 {@link LiveScheduleEvent}를 {@link LiveNotificationListener}와 함께 듣는다. 하는 일이
 * 다르기 때문이다 — 그쪽은 <b>지금</b> 알리고, 여기는 <b>나중에</b> 알릴 것을 예약한다.
 *
 * <p><b>3단계까지는 10분 고정이다.</b> 알림이 하나도 오지 않는데 설정 화면을 넷(강사·학생 ×
 * 커리큘럼·강의) 만들 이유가 없다. 선택지를 열 때는 이미 예약된 미래 세션에 나머지 리드타임 행을
 * 채우는 이관이 필요하다.
 */
@Service
public class NotificationScheduleService {

    private static final Logger log = LoggerFactory.getLogger(NotificationScheduleService.class);

    private final NotificationScheduleRepository repository;
    private final int leadMinutes;

    public NotificationScheduleService(NotificationScheduleRepository repository,
                                       @Value("${notification.live-starting-soon.lead-minutes:10}") int leadMinutes) {
        this.repository = repository;
        this.leadMinutes = leadMinutes;
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    @Transactional(propagation = org.springframework.transaction.annotation.Propagation.MANDATORY)
    public void onSchedule(LiveScheduleEvent event) {
        switch (event.kind()) {
            case SCHEDULED, RESCHEDULED -> upsert(event);
            /*
             * 취소된 라이브에 "곧 시작합니다"가 나가면 안 된다. 행을 남겨 두고 발화 시점에
             * 세션 상태를 다시 보는 방법도 있지만, 지울 수 있을 때 지우는 편이 확실하다.
             */
            case CANCELED -> repository.deleteByLiveSessionId(event.sessionId());
        }
    }

    private void upsert(LiveScheduleEvent event) {
        OffsetDateTime startsAt = event.nextStartsAt();
        if (startsAt == null) {
            return;
        }
        NotificationSchedule schedule = repository
                .findByLiveSessionIdAndLeadMinutes(event.sessionId(), leadMinutes)
                .orElseGet(() -> {
                    NotificationSchedule created = new NotificationSchedule();
                    created.setLiveSessionId(event.sessionId());
                    created.setLeadMinutes(leadMinutes);
                    return created;
                });
        schedule.setStartsAt(startsAt);
        schedule.setFireAt(startsAt.minusMinutes(leadMinutes));
        /*
         * 일정이 바뀌면 다시 나갈 수 있어야 한다. 이미 발화한 회차라도 새 시각이 아직 오지
         * 않았다면 그 시각에 다시 알리는 것이 맞다 — 학생이 아는 시각이 바뀌었기 때문이다.
         */
        schedule.setFiredAt(null);
        repository.save(schedule);
        log.debug("발화 예정 갱신 session={} fireAt={}", event.sessionId(), schedule.getFireAt());
    }
}
