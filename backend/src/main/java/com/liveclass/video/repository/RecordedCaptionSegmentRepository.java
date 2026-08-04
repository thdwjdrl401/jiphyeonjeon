package com.liveclass.video.repository;

import com.liveclass.video.domain.RecordedCaptionSegment;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.UUID;
import java.util.List;

public interface RecordedCaptionSegmentRepository extends JpaRepository<RecordedCaptionSegment, Long> {
    long countByJobId(UUID jobId);

    List<RecordedCaptionSegment> findByTrackIdAndJobIdOrderByStartMsAscLocalSegmentIndexAsc(
            UUID trackId, UUID jobId);

    /** 질문 시점 뒤에 시작한 발화는 제외하고, 직전 window와 질문을 포함하는 발화를 시간순으로 읽는다. */
    @Query("""
            select segment from RecordedCaptionSegment segment
            where segment.trackId = :trackId
              and segment.jobId = :jobId
              and segment.startMs <= :questionMs
              and segment.endMs >= :windowStartMs
            order by segment.startMs asc, segment.localSegmentIndex asc
            """)
    List<RecordedCaptionSegment> findContextSegments(
            @Param("trackId") UUID trackId,
            @Param("jobId") UUID jobId,
            @Param("windowStartMs") long windowStartMs,
            @Param("questionMs") long questionMs);
}
