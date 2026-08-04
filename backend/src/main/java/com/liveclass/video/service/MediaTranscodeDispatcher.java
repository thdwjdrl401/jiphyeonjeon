package com.liveclass.video.service;

import com.liveclass.video.config.MediaTranscodeMessagingConfig;
import com.liveclass.video.domain.MediaTranscodeJob;
import com.liveclass.video.domain.MediaTranscodeJobStatus;
import com.liveclass.video.domain.RecordedVideo;
import com.liveclass.video.domain.RecordedVideoStatus;
import com.liveclass.video.repository.MediaTranscodeJobRepository;
import com.liveclass.video.repository.RecordedVideoRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

import java.time.OffsetDateTime;
import java.util.List;

/** DB에 커밋된 PENDING 변환 작업을 선점해 durable RabbitMQ 큐로 발행한다. */
@Component
public class MediaTranscodeDispatcher {

    private static final Logger log = LoggerFactory.getLogger(MediaTranscodeDispatcher.class);
    private static final int MAX_ATTEMPTS = 10;

    private final MediaTranscodeJobRepository jobRepository;
    private final RecordedVideoRepository recordedVideoRepository;
    private final RabbitTemplate rabbitTemplate;
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    public MediaTranscodeDispatcher(MediaTranscodeJobRepository jobRepository,
                                    RecordedVideoRepository recordedVideoRepository,
                                    RabbitTemplate rabbitTemplate) {
        this.jobRepository = jobRepository;
        this.recordedVideoRepository = recordedVideoRepository;
        this.rabbitTemplate = rabbitTemplate;
    }

    @Scheduled(fixedDelayString = "${recorded.video.dispatch.fixed-delay-ms:3000}",
            initialDelayString = "${recorded.video.dispatch.initial-delay-ms:15000}")
    @Transactional
    public void publishPending() {
        List<MediaTranscodeJob> jobs = jobRepository.lockPendingForDispatch(OffsetDateTime.now());
        for (MediaTranscodeJob job : jobs) {
            publish(job);
        }
    }

    private void publish(MediaTranscodeJob job) {
        RecordedVideo video = recordedVideoRepository.findById(job.getRecordedVideoId()).orElse(null);
        if (video == null || video.getSourceAssetId() == null) {
            failPermanently(job, video, "SOURCE_NOT_READY");
            return;
        }

        MediaTranscodeMessage message = new MediaTranscodeMessage(
                "MP4_TO_HLS", job.getId(), video.getId(), video.getLessonId(), video.getSourceAssetId(),
                "recorded/" + video.getId(), 1);
        try {
            String payload = jsonMapper.writeValueAsString(message);
            rabbitTemplate.convertAndSend(MediaTranscodeMessagingConfig.TRANSCODE_QUEUE, payload);
            job.setStatus(MediaTranscodeJobStatus.DISPATCHED);
            job.setPublishedAt(OffsetDateTime.now());
            log.info("녹화강의 변환 작업 발행 jobId={} recordedVideoId={}", job.getId(), video.getId());
        } catch (RuntimeException e) {
            int attempts = job.getPublishAttemptCount() + 1;
            job.setPublishAttemptCount(attempts);
            job.setLastError(e.getMessage());
            if (attempts >= MAX_ATTEMPTS) {
                failPermanently(job, video, "DISPATCH_FAILED");
            } else {
                long backoffSeconds = Math.min(300, 1L << Math.min(attempts, 8));
                job.setNextPublishAt(OffsetDateTime.now().plusSeconds(backoffSeconds));
                log.warn("녹화강의 변환 작업 발행 실패 jobId={} retry={}s", job.getId(), backoffSeconds);
            }
        }
    }

    private void failPermanently(MediaTranscodeJob job, RecordedVideo video, String failureCode) {
        job.setStatus(MediaTranscodeJobStatus.FAILED);
        job.setFinishedAt(OffsetDateTime.now());
        job.setLastError(failureCode);
        if (video != null && video.getStatus() != RecordedVideoStatus.READY) {
            video.setStatus(RecordedVideoStatus.FAILED);
            video.setFailureCode(failureCode);
        }
        log.error("녹화강의 변환 작업 발행 영구 실패 jobId={} code={}", job.getId(), failureCode);
    }
}
