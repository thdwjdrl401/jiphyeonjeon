package com.liveclass.video.service;

import com.liveclass.video.config.RecordedSttMessagingConfig;
import com.liveclass.video.domain.RecordedCaptionStatus;
import com.liveclass.video.domain.RecordedCaptionTrack;
import com.liveclass.video.domain.RecordedSttJob;
import com.liveclass.video.domain.RecordedSttJobStatus;
import com.liveclass.video.domain.RecordedVideo;
import com.liveclass.video.repository.RecordedCaptionTrackRepository;
import com.liveclass.video.repository.RecordedSttJobRepository;
import com.liveclass.video.repository.RecordedVideoRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.List;

@Component
@ConditionalOnProperty(name = "recorded.stt.enabled", havingValue = "true")
public class RecordedSttDispatcher {

    private static final Logger log = LoggerFactory.getLogger(RecordedSttDispatcher.class);
    private static final int MAX_ATTEMPTS = 10;

    private final RecordedSttJobRepository jobRepository;
    private final RecordedVideoRepository videoRepository;
    private final RecordedCaptionTrackRepository trackRepository;
    private final RabbitTemplate rabbitTemplate;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public RecordedSttDispatcher(RecordedSttJobRepository jobRepository,
                                 RecordedVideoRepository videoRepository,
                                 RecordedCaptionTrackRepository trackRepository,
                                 RabbitTemplate rabbitTemplate) {
        this.jobRepository = jobRepository;
        this.videoRepository = videoRepository;
        this.trackRepository = trackRepository;
        this.rabbitTemplate = rabbitTemplate;
    }

    @Scheduled(fixedDelayString = "${recorded.stt.dispatch.fixed-delay-ms:3000}",
            initialDelayString = "${recorded.stt.dispatch.initial-delay-ms:15000}")
    @Transactional
    public void publishPending() {
        List<RecordedSttJob> jobs = jobRepository.lockPendingForDispatch(OffsetDateTime.now());
        jobs.forEach(this::publish);
    }

    private void publish(RecordedSttJob job) {
        RecordedVideo video = videoRepository.findById(job.getRecordedVideoId()).orElse(null);
        RecordedCaptionTrack track = trackRepository.findByRecordedVideoId(job.getRecordedVideoId()).orElse(null);
        if (video == null || track == null || video.getSourceAssetId() == null
                || !video.getSourceAssetId().equals(job.getSourceAssetId())) {
            failPermanently(job, track, "SOURCE_NOT_READY");
            return;
        }
        try {
            RecordedSttMessage message = new RecordedSttMessage(
                    "RECORDED_STT", job.getId(), video.getId(), video.getLessonId(),
                    job.getSourceAssetId(), job.getLanguage(), 1);
            rabbitTemplate.convertAndSend(
                    RecordedSttMessagingConfig.TRANSCRIBE_QUEUE,
                    jsonMapper.writeValueAsString(message));
            job.setStatus(RecordedSttJobStatus.DISPATCHED);
            job.setPublishedAt(OffsetDateTime.now());
            track.setStatus(RecordedCaptionStatus.PROCESSING);
            track.setFailureCode(null);
            log.info("녹화강의 STT 작업 발행 jobId={} recordedVideoId={}", job.getId(), video.getId());
        } catch (RuntimeException e) {
            int attempts = job.getPublishAttemptCount() + 1;
            job.setPublishAttemptCount(attempts);
            job.setLastError(e.getClass().getSimpleName());
            if (attempts >= MAX_ATTEMPTS) {
                failPermanently(job, track, "DISPATCH_FAILED");
            } else {
                long backoffSeconds = Math.min(300, 1L << Math.min(attempts, 8));
                job.setNextPublishAt(OffsetDateTime.now().plusSeconds(backoffSeconds));
                log.warn("녹화강의 STT 작업 발행 실패 jobId={} retry={}s", job.getId(), backoffSeconds);
            }
        }
    }

    private void failPermanently(RecordedSttJob job, RecordedCaptionTrack track, String failureCode) {
        job.setStatus(RecordedSttJobStatus.FAILED);
        job.setFailureCode(failureCode);
        job.setLastError(failureCode);
        job.setFinishedAt(OffsetDateTime.now());
        if (track != null && track.getStatus() != RecordedCaptionStatus.READY) {
            track.setStatus(RecordedCaptionStatus.FAILED);
            track.setFailureCode(failureCode);
        }
        log.error("녹화강의 STT 작업 발행 영구 실패 jobId={} code={}", job.getId(), failureCode);
    }
}
