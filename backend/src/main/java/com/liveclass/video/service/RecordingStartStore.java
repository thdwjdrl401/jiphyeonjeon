package com.liveclass.video.service;

import com.liveclass.video.domain.ReplayStatus;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * StartEgress 외부 호출 전후의 짧은 video_asset 트랜잭션(ADR-0002 §3·§4).
 */
@Service
public class RecordingStartStore {

    private final VideoAssetRepository videoAssetRepository;

    public RecordingStartStore(VideoAssetRepository videoAssetRepository) {
        this.videoAssetRepository = videoAssetRepository;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public StartPreparation prepare(UUID sessionId, UUID lessonId, String bucket, String manifestKey) {
        VideoAsset asset = videoAssetRepository.findByLiveSessionId(sessionId).orElse(null);
        if (asset != null && asset.getStatus() != VideoAssetStatus.FAILED) {
            if (asset.getEgressId() != null && !asset.getEgressId().isBlank()) {
                return new StartPreparation(StartMode.ALREADY_ACCEPTED, asset.getEgressId());
            }
            // STARTING인데 ID가 없으면 이전 StartEgress 응답이 유실됐을 수 있다. 다시 생성하지 않고 list로 찾는다.
            return new StartPreparation(StartMode.RECONCILE_UNKNOWN, null);
        }
        if (asset == null) {
            asset = new VideoAsset();
            asset.setLiveSessionId(sessionId);
            asset.setLessonId(lessonId);
            asset.setReplayStatus(ReplayStatus.DRAFT);
        }
        asset.setEgressId(null);
        asset.setFailureCode(null);
        asset.setBucket(bucket);
        asset.setHlsManifestKey(manifestKey);
        asset.setRecordingStartedAt(null);
        asset.setRecordingEndedAt(null);
        asset.setStatus(VideoAssetStatus.STARTING);
        videoAssetRepository.saveAndFlush(asset);
        return new StartPreparation(StartMode.START_REQUIRED, null);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void attachEgress(UUID sessionId, String egressId) {
        VideoAsset asset = videoAssetRepository.findByLiveSessionId(sessionId)
                .orElseThrow(() -> new IllegalStateException("Egress를 연결할 video_asset이 없습니다."));
        if (asset.getEgressId() != null && !asset.getEgressId().equals(egressId)) {
            throw new IllegalStateException("video_asset에 서로 다른 Egress ID가 감지됐습니다.");
        }
        asset.setEgressId(egressId);
        asset.setStatus(VideoAssetStatus.RECORDING);
        if (asset.getRecordingStartedAt() == null) {
            asset.setRecordingStartedAt(OffsetDateTime.now());
        }
        asset.setFailureCode(null);
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void markStartFailed(UUID sessionId, String failureCode) {
        videoAssetRepository.findByLiveSessionId(sessionId).ifPresent(asset -> {
            asset.setStatus(VideoAssetStatus.FAILED);
            asset.setFailureCode(failureCode);
        });
    }

    public enum StartMode {
        START_REQUIRED,
        RECONCILE_UNKNOWN,
        ALREADY_ACCEPTED
    }

    public record StartPreparation(StartMode mode, String egressId) {
    }
}
