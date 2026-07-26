package com.liveclass.aiintegration.repository;

import com.liveclass.aiintegration.domain.OutboxEvent;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OutboxEventRepository extends JpaRepository<OutboxEvent, Long> {

    boolean existsByIdempotencyKey(String idempotencyKey);
}
