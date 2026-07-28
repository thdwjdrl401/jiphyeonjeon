package com.liveclass.live.repository;

import com.liveclass.live.domain.LiveAgentJob;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;
import java.util.UUID;

public interface LiveAgentJobRepository extends JpaRepository<LiveAgentJob, UUID> {

    Optional<LiveAgentJob> findByLiveStartAttemptId(UUID liveStartAttemptId);
}
