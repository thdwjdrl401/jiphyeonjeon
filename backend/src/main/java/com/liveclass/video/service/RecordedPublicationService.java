package com.liveclass.video.service;

import com.liveclass.video.domain.RecordedCaptionPublicationStatus;
import com.liveclass.video.domain.RecordedCaptionStatus;
import com.liveclass.video.domain.RecordedCaptionTrack;
import com.liveclass.video.domain.RecordedPublicationStatus;
import com.liveclass.video.domain.RecordedSttJob;
import com.liveclass.video.domain.RecordedSttJobStatus;
import com.liveclass.video.domain.RecordedVideo;
import com.liveclass.video.domain.RecordedVideoStatus;
import com.liveclass.video.repository.RecordedCaptionSegmentRepository;
import com.liveclass.video.repository.RecordedCaptionTrackRepository;
import com.liveclass.video.repository.RecordedSttJobRepository;
import com.liveclass.video.repository.RecordedVideoRepository;
import io.micrometer.core.instrument.MeterRegistry;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Duration;
import java.time.OffsetDateTime;
import java.util.UUID;

/** HLS와 STT의 독립 상태를 한 재생 패키지 게시 상태로 합류시킨다. */
@Service
public class RecordedPublicationService {

    private static final Logger log = LoggerFactory.getLogger(RecordedPublicationService.class);

    private final RecordedVideoRepository videoRepository;
    private final RecordedCaptionTrackRepository trackRepository;
    private final RecordedSttJobRepository sttJobRepository;
    private final RecordedCaptionSegmentRepository segmentRepository;
    private final MeterRegistry meterRegistry;

    public RecordedPublicationService(RecordedVideoRepository videoRepository,
                                      RecordedCaptionTrackRepository trackRepository,
                                      RecordedSttJobRepository sttJobRepository,
                                      RecordedCaptionSegmentRepository segmentRepository,
                                      MeterRegistry meterRegistry) {
        this.videoRepository = videoRepository;
        this.trackRepository = trackRepository;
        this.sttJobRepository = sttJobRepository;
        this.segmentRepository = segmentRepository;
        this.meterRegistry = meterRegistry;
    }

    /**
     * recorded_video 행을 잠근 뒤 현재 DB 상태를 다시 확인해 한 번만 게시한다.
     * callback 트랜잭션에서 호출되면 상태 확정과 게시가 같은 커밋에 포함된다.
     */
    @Transactional
    public boolean tryAutoPublish(UUID recordedVideoId) {
        RecordedVideo video = videoRepository.findByIdForUpdate(recordedVideoId)
                .orElseThrow(() -> new IllegalStateException("자동 게시할 녹화강의가 없습니다."));
        if (video.getPublicationStatus() == RecordedPublicationStatus.PUBLISHED) {
            return true;
        }
        if (video.getStatus() != RecordedVideoStatus.READY) {
            meterRegistry.counter("recorded.delivery.publish.blocked", "reason", "video").increment();
            return false;
        }

        RecordedCaptionTrack track = trackRepository.findByRecordedVideoId(recordedVideoId).orElse(null);
        if (track == null || (track.getStatus() != RecordedCaptionStatus.READY
                && track.getStatus() != RecordedCaptionStatus.EMPTY)) {
            meterRegistry.counter("recorded.delivery.publish.blocked", "reason", "caption").increment();
            return false;
        }
        if (!hasConsistentTerminalResult(track)) {
            meterRegistry.counter("recorded.delivery.publish.blocked", "reason", "caption_result").increment();
            return false;
        }

        OffsetDateTime publishedAt = OffsetDateTime.now();
        video.setPublicationStatus(RecordedPublicationStatus.PUBLISHED);
        video.setPublishedAt(publishedAt);
        if (track.getStatus() == RecordedCaptionStatus.READY) {
            track.setPublicationStatus(RecordedCaptionPublicationStatus.PUBLISHED);
            track.setPublishedAt(publishedAt);
        } else {
            track.setPublicationStatus(RecordedCaptionPublicationStatus.NOT_AVAILABLE);
            track.setPublishedAt(null);
        }

        meterRegistry.counter("recorded.delivery.auto.publish").increment();
        if (video.getCreatedAt() != null) {
            meterRegistry.timer("recorded.delivery.publish.wait")
                    .record(Duration.between(video.getCreatedAt(), publishedAt));
        }
        log.info("Recorded delivery auto-published lessonId={} recordedVideoId={} captionStatus={}",
                video.getLessonId(), video.getId(), track.getStatus());
        return true;
    }

    private boolean hasConsistentTerminalResult(RecordedCaptionTrack track) {
        UUID activeJobId = track.getActiveJobId();
        if (activeJobId == null) {
            return false;
        }
        RecordedSttJob job = sttJobRepository.findById(activeJobId).orElse(null);
        if (job == null || job.getStatus() != RecordedSttJobStatus.SUCCEEDED
                || !job.getRecordedVideoId().equals(track.getRecordedVideoId())) {
            return false;
        }
        long storedSegments = segmentRepository.countByJobId(activeJobId);
        return storedSegments == track.getSegmentCount()
                && (track.getStatus() != RecordedCaptionStatus.READY || storedSegments > 0)
                && (track.getStatus() != RecordedCaptionStatus.EMPTY || storedSegments == 0);
    }
}
