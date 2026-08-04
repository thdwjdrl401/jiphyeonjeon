package com.liveclass.video.service;

import com.liveclass.video.domain.RecordedPublicationStatus;
import com.liveclass.video.domain.RecordedVideoStatus;
import com.liveclass.video.repository.RecordedVideoRepository;
import io.micrometer.core.instrument.MeterRegistry;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import java.time.Duration;
import java.time.OffsetDateTime;

/** callback commit 경계에서 게시 평가가 빠진 DRAFT 조합을 저빈도로 복구한다. */
@Component
public class RecordedPublicationReconciler {

    private final RecordedVideoRepository videoRepository;
    private final RecordedPublicationService publicationService;
    private final MeterRegistry meterRegistry;

    public RecordedPublicationReconciler(RecordedVideoRepository videoRepository,
                                         RecordedPublicationService publicationService,
                                         MeterRegistry meterRegistry) {
        this.videoRepository = videoRepository;
        this.publicationService = publicationService;
        this.meterRegistry = meterRegistry;
    }

    @Scheduled(
            fixedDelayString = "${recorded.publication.reconcile-delay-ms:60000}",
            initialDelayString = "${recorded.publication.reconcile-initial-delay-ms:60000}")
    public void reconcile() {
        OffsetDateTime stuckBefore = OffsetDateTime.now().minus(Duration.ofMinutes(10));
        videoRepository.findTop100ByPublicationStatusAndStatusOrderByUpdatedAtAsc(
                        RecordedPublicationStatus.DRAFT,
                        RecordedVideoStatus.READY)
                .forEach(video -> {
                    if (video.getUpdatedAt() != null && video.getUpdatedAt().isBefore(stuckBefore)) {
                        meterRegistry.counter("recorded.delivery.stuck.draft").increment();
                    }
                    publicationService.tryAutoPublish(video.getId());
                });
    }
}
