package com.liveclass.live.repository;

import com.liveclass.live.domain.LiveAiAnswer;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.UUID;

public interface LiveAiAnswerRepository extends JpaRepository<LiveAiAnswer, Long> {

    /**
     * 내 질문만, 물어본 순서대로. <b>{@code userId}가 조건에 반드시 있어야 한다</b> —
     * 빠지면 같은 세션의 남의 질문이 함께 나온다.
     */
    List<LiveAiAnswer> findBySessionIdAndUserIdOrderByAskedAtAscIdAsc(UUID sessionId, UUID userId);

    boolean existsByRequestId(String requestId);
}
