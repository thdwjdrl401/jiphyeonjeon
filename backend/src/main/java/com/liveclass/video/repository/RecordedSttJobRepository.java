package com.liveclass.video.repository;

import com.liveclass.video.domain.RecordedSttJob;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface RecordedSttJobRepository extends JpaRepository<RecordedSttJob, UUID> {

    Optional<RecordedSttJob> findTopByRecordedVideoIdOrderByAttemptNoDesc(UUID recordedVideoId);

    @Query(value = """
            SELECT * FROM core.recorded_stt_job
            WHERE status = 'PENDING' AND next_publish_at <= :cutoff
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 100
            """, nativeQuery = true)
    List<RecordedSttJob> lockPendingForDispatch(OffsetDateTime cutoff);
}
