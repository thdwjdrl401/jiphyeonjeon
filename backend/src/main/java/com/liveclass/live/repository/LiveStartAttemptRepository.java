package com.liveclass.live.repository;

import com.liveclass.live.domain.LiveStartAttempt;
import com.liveclass.live.domain.LiveStartAttemptStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface LiveStartAttemptRepository extends JpaRepository<LiveStartAttempt, UUID> {

    /** 이 세션의 진행 중 시도. 부분 유니크 인덱스가 최대 1건을 보장한다. */
    Optional<LiveStartAttempt> findByLiveSessionIdAndStatus(UUID liveSessionId, LiveStartAttemptStatus status);

    /** 상태 폴링용 — 세션의 가장 최근 시도(진행 중이든 끝났든). */
    Optional<LiveStartAttempt> findFirstByLiveSessionIdOrderByCreatedAtDesc(UUID liveSessionId);

    Optional<LiveStartAttempt> findByOperationId(UUID operationId);

    /** 즉시 trigger와 scheduled reconciler가 같은 attempt를 동시에 집지 않게 row lock으로 읽는다. */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from LiveStartAttempt a where a.id = :attemptId")
    Optional<LiveStartAttempt> findByIdForUpdate(@Param("attemptId") UUID attemptId);

    /** lease가 없거나 만료된 오래된 IN_PROGRESS attempt. 실제 claim은 위 row lock 메서드가 확정한다. */
    @Query("""
            select a from LiveStartAttempt a
            where a.status = com.liveclass.live.domain.LiveStartAttemptStatus.IN_PROGRESS
              and (a.nextAttemptAt is null or a.nextAttemptAt <= :now)
              and (a.leaseUntil is null or a.leaseUntil <= :now)
            order by a.createdAt asc
            """)
    List<LiveStartAttempt> findRecoverable(@Param("now") OffsetDateTime now, Pageable pageable);
}
