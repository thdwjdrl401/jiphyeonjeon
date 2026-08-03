package com.liveclass.notification.repository;

import com.liveclass.notification.domain.NotificationSchedule;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface NotificationScheduleRepository extends JpaRepository<NotificationSchedule, UUID> {

    Optional<NotificationSchedule> findByLiveSessionIdAndLeadMinutes(UUID liveSessionId, Integer leadMinutes);

    /** 발화할 것들. 아직 안 나갔고 시각이 된 것만, 오래된 순으로. */
    List<NotificationSchedule> findTop100ByFiredAtIsNullAndFireAtLessThanEqualOrderByFireAtAsc(
            OffsetDateTime now);

    void deleteByLiveSessionId(UUID liveSessionId);
}
