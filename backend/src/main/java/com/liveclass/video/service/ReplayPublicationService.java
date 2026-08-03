package com.liveclass.video.service;

import com.liveclass.live.api.LiveSessionDirectory;
import com.liveclass.live.api.LiveSessionView;
import com.liveclass.video.api.LessonPlaybackAccess;
import com.liveclass.video.api.ReplayPublishedEvent;
import com.liveclass.video.api.PlaybackAccessException;
import com.liveclass.video.domain.ReplayStatus;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Set;
import java.util.UUID;

/** 소유 강사의 종료 후 다시보기 게시·철회 상태 전환. */
@Service
public class ReplayPublicationService {

    private static final Logger log = LoggerFactory.getLogger(ReplayPublicationService.class);
    private static final Set<String> WITHDRAWABLE_SESSION_STATUSES = Set.of("ENDED", "CANCELLED", "FAILED");

    private final VideoAssetRepository videoAssetRepository;
    private final LessonPlaybackAccess playbackAccess;
    private final LiveSessionDirectory liveSessionDirectory;
    private final ApplicationEventPublisher eventPublisher;

    public ReplayPublicationService(VideoAssetRepository videoAssetRepository,
                                    LessonPlaybackAccess playbackAccess,
                                    LiveSessionDirectory liveSessionDirectory,
                                    ApplicationEventPublisher eventPublisher) {
        this.videoAssetRepository = videoAssetRepository;
        this.playbackAccess = playbackAccess;
        this.liveSessionDirectory = liveSessionDirectory;
        this.eventPublisher = eventPublisher;
    }

    @Transactional
    public void publish(UUID userId, UUID lessonId) {
        VideoAsset asset = requireOwnedAsset(userId, lessonId);
        if (asset.getStatus() != VideoAssetStatus.READY) {
            throw new ReplayPublishConflictException("녹화가 준비(READY)된 뒤에 게시할 수 있습니다.");
        }
        if (asset.getReplayStatus() == ReplayStatus.PUBLISHED) {
            return;
        }
        asset.setReplayStatus(ReplayStatus.PUBLISHED);
        asset.setPublishedBy(userId);
        asset.setPublishedAt(OffsetDateTime.now());
        asset.setWithdrawReason(null);
        log.info("다시보기 게시 lesson={} by={}", lessonId, userId);
        // 자동 공개와 같은 사건이다 — 학생 입장에서는 "다시 볼 수 있게 됐다"로 같다.
        eventPublisher.publishEvent(new ReplayPublishedEvent(
                asset.getId(), asset.getLessonId(), asset.getLiveSessionId(), asset.getPublishedAt()));
    }

    @Transactional
    public void withdraw(UUID userId, UUID lessonId, String reason) {
        VideoAsset asset = requireOwnedAsset(userId, lessonId);
        LiveSessionView session = liveSessionDirectory.findById(asset.getLiveSessionId())
                .orElseThrow(() -> new ReplayNotFoundException("라이브 세션을 찾을 수 없습니다."));
        if (!WITHDRAWABLE_SESSION_STATUSES.contains(session.liveSessionStatus())) {
            throw new ReplayWithdrawWhileLiveException(
                    "라이브 진행 중에는 다시보기를 철회할 수 없습니다. 세션 종료 후 다시 시도해 주세요.");
        }
        if (asset.getReplayStatus() == ReplayStatus.WITHDRAWN) {
            return;
        }
        asset.setReplayStatus(ReplayStatus.WITHDRAWN);
        asset.setWithdrawReason(reason);
        log.info("다시보기 철회 lesson={} by={}", lessonId, userId);
    }

    private VideoAsset requireOwnedAsset(UUID userId, UUID lessonId) {
        boolean owner;
        try {
            owner = playbackAccess.resolve(userId, lessonId).owner();
        } catch (PlaybackAccessException e) {
            owner = false;
        }
        if (!owner) {
            throw new ReplayForbiddenException("이 레슨의 소유 강사만 다시보기를 관리할 수 있습니다.");
        }
        return videoAssetRepository.findByLessonId(lessonId)
                .orElseThrow(() -> new ReplayPublishConflictException("관리할 다시보기가 없습니다."));
    }
}
