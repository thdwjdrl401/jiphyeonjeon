package com.liveclass.aiintegration.repository;

import com.liveclass.aiintegration.domain.OutboxEvent;
import com.liveclass.aiintegration.domain.OutboxStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.time.OffsetDateTime;
import java.util.List;

public interface OutboxEventRepository extends JpaRepository<OutboxEvent, Long> {

    boolean existsByIdempotencyKey(String idempotencyKey);

    /** 릴레이 발행 대상: 아직 PENDING이고 재시도 시각이 지난 것, 오래된 순으로 최대 100건. */
    List<OutboxEvent> findTop100ByStatusAndNextAttemptAtLessThanEqualOrderByCreatedAtAsc(
            OutboxStatus status, OffsetDateTime cutoff);
}
