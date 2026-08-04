package com.liveclass.video.repository;

import com.liveclass.video.domain.RecordedCaptionSegment;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.UUID;
import java.util.List;

public interface RecordedCaptionSegmentRepository extends JpaRepository<RecordedCaptionSegment, Long> {
    long countByJobId(UUID jobId);

    List<RecordedCaptionSegment> findByTrackIdAndJobIdOrderByStartMsAscLocalSegmentIndexAsc(
            UUID trackId, UUID jobId);
}
