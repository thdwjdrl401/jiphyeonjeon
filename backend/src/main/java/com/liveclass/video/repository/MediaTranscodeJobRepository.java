package com.liveclass.video.repository;

import com.liveclass.video.domain.MediaTranscodeJob;
import com.liveclass.video.domain.MediaTranscodeJobStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface MediaTranscodeJobRepository extends JpaRepository<MediaTranscodeJob, UUID> {

    Optional<MediaTranscodeJob> findFirstByRecordedVideoIdAndStatusInOrderByAttemptNoDesc(
            UUID recordedVideoId, List<MediaTranscodeJobStatus> statuses);

    Optional<MediaTranscodeJob> findTopByRecordedVideoIdOrderByAttemptNoDesc(UUID recordedVideoId);

    @Query(value = """
            SELECT * FROM core.media_transcode_job
            WHERE status = 'PENDING' AND next_publish_at <= :cutoff
            ORDER BY created_at
            FOR UPDATE SKIP LOCKED
            LIMIT 100
            """, nativeQuery = true)
    List<MediaTranscodeJob> lockPendingForDispatch(OffsetDateTime cutoff);
}
