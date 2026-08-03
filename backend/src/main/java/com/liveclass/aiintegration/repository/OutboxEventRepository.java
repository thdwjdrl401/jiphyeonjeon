package com.liveclass.aiintegration.repository;

import com.liveclass.aiintegration.domain.OutboxEvent;
import com.liveclass.aiintegration.domain.OutboxStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;

public interface OutboxEventRepository extends JpaRepository<OutboxEvent, Long> {

    boolean existsByIdempotencyKey(String idempotencyKey);

    /**
     * 지금 보낼 것이 있는 <b>목적지들</b>. 릴레이가 목적지마다 따로 배치를 뽑기 위한 첫 단계다.
     *
     * <p>목적지 수는 큐 종류만큼(현재 둘)이라 이 조회 자체는 늘 작다.
     */
    @Query("""
            SELECT DISTINCT e.destination FROM OutboxEvent e
            WHERE e.status = :status AND e.nextAttemptAt <= :cutoff
            """)
    List<String> findPendingDestinations(@Param("status") OutboxStatus status,
                                         @Param("cutoff") OffsetDateTime cutoff);

    /**
     * 릴레이 발행 대상: 한 <b>목적지</b>의 PENDING을 오래된 순으로 최대 100건.
     *
     * <p>목적지를 조건에 넣은 것이 핵심이다. 전체에서 100건을 뽑으면 알림이 1,000건 쌓였을 때 자료
     * 임베딩 잡이 뒤로 밀려 <b>업로드하고 한참 뒤에야</b> 임베딩이 시작된다(머리 막힘).
     */
    List<OutboxEvent> findTop100ByStatusAndDestinationAndNextAttemptAtLessThanEqualOrderByCreatedAtAsc(
            OutboxStatus status, String destination, OffsetDateTime cutoff);
}
