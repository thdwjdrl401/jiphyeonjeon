package com.liveclass.video.service;

import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

/** Egress 중지 전 녹화 자산을 짧은 트랜잭션으로 FINALIZING에 두는 저장 경계. */
@Service
public class RecordingStopStore {

    private final VideoAssetRepository videoAssetRepository;

    public RecordingStopStore(VideoAssetRepository videoAssetRepository) {
        this.videoAssetRepository = videoAssetRepository;
    }

    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public Optional<StopTarget> prepare(UUID sessionId) {
        VideoAsset asset = videoAssetRepository.findByLiveSessionId(sessionId).orElse(null);
        if (asset == null
                || (asset.getStatus() != VideoAssetStatus.RECORDING
                && asset.getStatus() != VideoAssetStatus.STARTING)) {
            return Optional.empty();
        }
        asset.setRecordingEndedAt(OffsetDateTime.now());
        asset.setStatus(VideoAssetStatus.FINALIZING);
        return Optional.of(new StopTarget(asset.getEgressId()));
    }

    public record StopTarget(String egressId) {
    }
}
