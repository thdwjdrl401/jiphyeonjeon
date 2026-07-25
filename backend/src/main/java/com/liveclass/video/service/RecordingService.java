package com.liveclass.video.service;

import com.liveclass.video.config.EgressProperties;
import com.liveclass.video.domain.ReplayStatus;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 라이브 녹화 생명주기 골격(songjeongki/0020). 세션 시작/종료 이벤트를 받아 Egress를 켜고 끄며
 * {@code video_asset} 상태기계를 전이한다. Egress 실패는 세션을 되돌리지 않는다(best-effort).
 *
 * <p>상태: REQUESTED → (egress 시작) RECORDING → (세션 종료) FINALIZING. FINALIZING→VERIFYING→READY는
 * Egress 완료 webhook으로 전이(후속). 시작 실패는 FAILED.
 *
 * <p>live 모듈에 의존하지 않는다 — 이벤트 필드를 원시값으로 받는다(경계는 {@link RecordingEventListener}가 담당).
 */
@Service
public class RecordingService {

    private static final Logger log = LoggerFactory.getLogger(RecordingService.class);

    private final VideoAssetRepository videoAssetRepository;
    private final EgressControl egressControl;
    private final EgressProperties egressProperties;

    public RecordingService(VideoAssetRepository videoAssetRepository, EgressControl egressControl,
                            EgressProperties egressProperties) {
        this.videoAssetRepository = videoAssetRepository;
        this.egressControl = egressControl;
        this.egressProperties = egressProperties;
    }

    /**
     * 세션 녹화 시작. 멱등(이미 자산 있으면 건너뜀). Egress 실패면 FAILED로 기록하고 넘어간다.
     * <p>REQUIRES_NEW 필수 — AFTER_COMMIT 리스너에서 호출되므로 REQUIRED면 이미 커밋된 원 트랜잭션에
     * 참여만 하고 새 커밋이 없어 video_asset이 저장되지 않는다.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void startRecording(UUID sessionId, UUID lessonId, String roomName) {
        if (videoAssetRepository.existsByLiveSessionId(sessionId)) {
            log.debug("이미 녹화 자산 존재 — 건너뜀 session={}", sessionId);
            return;
        }
        VideoAsset asset = new VideoAsset();
        asset.setLiveSessionId(sessionId);
        asset.setLessonId(lessonId);
        asset.setStatus(VideoAssetStatus.REQUESTED);
        asset.setReplayStatus(ReplayStatus.DRAFT);
        asset.setBucket(egressProperties.bucket());
        videoAssetRepository.save(asset);

        try {
            String egressId = egressControl.startHlsRecording(roomName, "sessions/" + sessionId);
            asset.setEgressId(egressId);
            asset.setStatus(VideoAssetStatus.RECORDING);
            asset.setRecordingStartedAt(OffsetDateTime.now());
            log.info("녹화 시작 session={} egressId={}", sessionId, egressId);
        } catch (RuntimeException e) {
            // best-effort: 녹화가 안 켜져도 세션은 그대로 진행된다. 실패 사실만 남긴다.
            asset.setStatus(VideoAssetStatus.FAILED);
            asset.setFailureCode("EGRESS_START_FAILED");
            log.warn("녹화 시작 실패(best-effort) session={}: {}", sessionId, e.getMessage());
        }
    }

    /**
     * 세션 녹화 중지. 녹화 중인 자산만 FINALIZING으로. Egress 중지 실패는 무시(webhook이 최종 정리).
     * REQUIRES_NEW 필수 — startRecording과 같은 이유(AFTER_COMMIT 경로).
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void stopRecording(UUID sessionId) {
        VideoAsset asset = videoAssetRepository.findByLiveSessionId(sessionId).orElse(null);
        if (asset == null) {
            log.debug("녹화 자산 없음(녹화 안 함) session={}", sessionId);
            return;
        }
        if (asset.getStatus() != VideoAssetStatus.RECORDING && asset.getStatus() != VideoAssetStatus.STARTING) {
            return;   // 이미 중지·실패 등 — 멱등
        }
        asset.setRecordingEndedAt(OffsetDateTime.now());
        asset.setStatus(VideoAssetStatus.FINALIZING);
        if (asset.getEgressId() != null) {
            try {
                egressControl.stopRecording(asset.getEgressId());
                log.info("녹화 중지 session={} egressId={}", sessionId, asset.getEgressId());
            } catch (RuntimeException e) {
                log.warn("녹화 중지 실패(무시) session={} egressId={}: {}", sessionId, asset.getEgressId(), e.getMessage());
            }
        }
    }

    /**
     * Egress 완료/실패 webhook을 반영해 자산을 확정한다(ADR-0034). 재생과는 무관한 뒷정리 —
     * 목록·썸네일 표시(duration/size)와 실패 감지를 위한 것이다.
     *
     * <p>멱등: 같은 완료 신호가 여러 번 와도 안전하다. 이미 READY/FAILED면 무시한다. 모르는 egressId도
     * 조용히 무시한다(우리 자산이 아님 — 잘못된 실패 표시를 만들지 않는다).
     *
     * @param success        EGRESS_COMPLETE면 true, 실패/중단이면 false
     * @param durationMs     녹화 길이(ms). 없으면 유지
     * @param sizeBytes      총 크기(bytes). 없으면 유지
     * @param segmentCount   세그먼트 수. 없으면 유지
     * @param failureCode    실패 코드(실패일 때)
     */
    @Transactional
    public void completeFromWebhook(String egressId, boolean success,
                                    Long durationMs, Long sizeBytes, Integer segmentCount, String failureCode) {
        VideoAsset asset = videoAssetRepository.findByEgressId(egressId).orElse(null);
        if (asset == null) {
            log.debug("모르는 egress webhook 무시 egressId={}", egressId);
            return;
        }
        if (asset.getStatus() == VideoAssetStatus.READY || asset.getStatus() == VideoAssetStatus.FAILED) {
            return;   // 이미 확정 — 멱등
        }
        if (success) {
            asset.setStatus(VideoAssetStatus.READY);
            asset.setReadyAt(OffsetDateTime.now());
            if (durationMs != null) {
                asset.setDurationMs(durationMs);
            }
            if (sizeBytes != null) {
                asset.setSizeBytes(sizeBytes);
            }
            if (segmentCount != null) {
                asset.setSegmentCount(segmentCount);
            }
            log.info("녹화 완료 확정 egressId={} durationMs={} size={}", egressId, durationMs, sizeBytes);
        } else {
            asset.setStatus(VideoAssetStatus.FAILED);
            asset.setFailureCode(failureCode != null ? failureCode : "EGRESS_FAILED");
            log.warn("녹화 실패 감지 egressId={} code={}", egressId, asset.getFailureCode());
        }
    }
}
