package com.liveclass.live.repository;

import com.liveclass.live.domain.LiveCaption;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface LiveCaptionRepository extends JpaRepository<LiveCaption, Long> {

    /** 멱등 사전 확인(fast path): 이미 소비한 eventId면 저장을 건너뛴다. */
    boolean existsByEventId(String eventId);

    /** eventId로 적재된 자막 조회(테스트·진단용). */
    Optional<LiveCaption> findByEventId(String eventId);

    /** 특정 세션의 적재 자막 수(테스트·진단용). */
    long countBySessionId(UUID sessionId);
}
