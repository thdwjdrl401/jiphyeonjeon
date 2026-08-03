package com.liveclass.notification.service;

import com.liveclass.live.api.LiveScheduleEvent;
import com.liveclass.notification.api.NotificationLeadTimes;
import com.liveclass.notification.domain.NotificationSchedule;
import com.liveclass.notification.repository.NotificationScheduleRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
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
 * <p><b>선택지 전부에 대해 예약 행을 만든다.</b> ADR은 처음에 "선택지를 열 때 이미 예약된 세션에
 * 나머지 리드타임 행을 채우는 이관이 필요하다"고 봤는데, 처음부터 전부 만들어 두면 그 이관 자체가
 * 사라진다 — 설정이 바뀌어도 예정 표를 손대지 않는다.
 *
 * <p>값은 세션당 행이 하나에서 여섯으로 느는 것인데, 그건 세션 수에 비례할 뿐 <b>수강생 수와
 * 무관하다</b>. 아무도 고르지 않은 리드타임의 행은 발화해도 0건을 넣고 끝난다.
 */
@Service
public class NotificationScheduleService {

    private static final Logger log = LoggerFactory.getLogger(NotificationScheduleService.class);

    private final NotificationScheduleRepository repository;

    public NotificationScheduleService(NotificationScheduleRepository repository) {
        this.repository = repository;
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
        for (int leadMinutes : NotificationLeadTimes.CHOICES) {
            upsertOne(event, startsAt, leadMinutes);
        }
    }

    private void upsertOne(LiveScheduleEvent event, OffsetDateTime startsAt, int leadMinutes) {
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
