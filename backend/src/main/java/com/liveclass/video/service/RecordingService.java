package com.liveclass.video.service;

import com.liveclass.video.config.EgressProperties;
import com.liveclass.video.api.RecordingFailedEvent;
import com.liveclass.video.api.RecordingReadyEvent;
import com.liveclass.video.api.ReplayPublishedEvent;
import com.liveclass.video.domain.ReplayStatus;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

/**
 * 라이브 녹화 생명주기(songjeongki/0020, choinhoo/0002·0003). 시작·종료 오케스트레이터의 호출을 받아
 * Egress를 켜고 끄며 {@code video_asset} 상태기계를 전이한다. HLS-only 정책에서 시작 전 Egress 실패는
 * LIVE를 막고, 종료 중지는 {@code LiveEndOrchestrator → LiveRecordingControl} 순차 호출로 수행한다.
 *
 * <p>상태: 신규/FAILED → STARTING → (egress ID 저장) RECORDING → (세션 종료) FINALIZING
 * → (egress 완료 webhook) VERIFYING → (스토리지에 매니페스트 확인) READY / FAILED.
 *
 * <p>live 모듈에 의존하지 않는다 — live가 선언한 포트의 구현 어댑터가 원시 sessionId를 넘긴다.
 */
@Service
public class RecordingService {

    private static final Logger log = LoggerFactory.getLogger(RecordingService.class);

    private final VideoAssetRepository videoAssetRepository;
    private final EgressControl egressControl;
    private final EgressProperties egressProperties;
    private final RecordingStorage recordingStorage;
    private final RecordingStartStore startStore;
    private final RecordingStopStore stopStore;
    private final ApplicationEventPublisher eventPublisher;

    public RecordingService(VideoAssetRepository videoAssetRepository, EgressControl egressControl,
                            EgressProperties egressProperties, RecordingStorage recordingStorage,
                            RecordingStartStore startStore, RecordingStopStore stopStore,
                            ApplicationEventPublisher eventPublisher) {
        this.videoAssetRepository = videoAssetRepository;
        this.egressControl = egressControl;
        this.egressProperties = egressProperties;
        this.recordingStorage = recordingStorage;
        this.startStore = startStore;
        this.stopStore = stopStore;
        this.eventPublisher = eventPublisher;
    }

    /**
     * 세션 녹화 시작(Gate A — API 수락, ADR-0002 §4). 멱등: 이미 진행 중인 자산이면 그대로 성공으로 본다.
     * 이전 시도가 {@code FAILED}로 남아 있으면 같은 행을 재사용해 다시 시도한다 — 강사가 재시작을 누를 수
     * 있어야 하므로 실패한 자산이 영구히 재시도를 막으면 안 된다.
     *
     * <p>외부 Egress 호출 전후 DB 변경은 {@link RecordingStartStore}의 짧은 REQUIRES_NEW
     * 트랜잭션으로 분리한다. 네트워크를 기다리는 동안 DB 트랜잭션을 열어 두지 않는다.
     *
     * @return Egress 시작이 수락되면 true, 명시적으로 실패하면 false
     */
    public boolean startRecording(UUID sessionId, UUID lessonId, String roomName) {
        RecordingStartStore.StartPreparation preparation =
                startStore.prepare(sessionId, lessonId, egressProperties.bucket(), manifestKey(sessionId));
        if (preparation.mode() == RecordingStartStore.StartMode.ALREADY_ACCEPTED) {
            log.debug("이미 Egress ID가 저장됨 — 재사용 session={} egressId={}",
                    sessionId, preparation.egressId());
            return true;
        }
        if (preparation.mode() == RecordingStartStore.StartMode.RECONCILE_UNKNOWN) {
            // 이전 호출의 응답이 유실됐을 수 있다. pollReadiness가 room list로 ID를 복구한다.
            log.info("Egress 시작 결과 재조정 대기 session={}", sessionId);
            return true;
        }

        try {
            // 외부 I/O: 위 prepare 트랜잭션은 이미 끝났고, 아래 attach는 새 짧은 트랜잭션이다.
            String egressId = egressControl.startHlsRecording(roomName, objectPrefix(sessionId));
            startStore.attachEgress(sessionId, egressId);
            log.info("녹화 시작 session={} egressId={}", sessionId, egressId);
            return true;
        } catch (EgressStartOutcomeUnknownException e) {
            // 원격 성공 가능성이 있으므로 FAILED로 바꾸지 않는다. Gate B polling이 room list로 복구한다.
            log.warn("Egress 시작 응답 유실 — 재조정 대기 session={}: {}", sessionId, e.getMessage());
            return true;
        } catch (RuntimeException e) {
            startStore.markStartFailed(sessionId, "EGRESS_START_FAILED");
            log.warn("녹화 시작 실패 session={}: {}", sessionId, e.getMessage());
            return false;
        }
    }

    /**
     * 시작 실패 정리(ADR-0002 §6). 원격 Egress가 있으면 멱등 중지하고 자산을 실패로 남긴다.
     * 예외를 던지지 않는다 — 정리 실패가 강사의 재시도를 막으면 안 된다.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void abortRecording(UUID sessionId, String failureCode) {
        VideoAsset asset = videoAssetRepository.findByLiveSessionId(sessionId).orElse(null);
        if (asset == null || asset.getStatus() == VideoAssetStatus.READY) {
            return;
        }
        if (asset.getEgressId() != null) {
            try {
                egressControl.stopRecording(asset.getEgressId());
            } catch (RuntimeException e) {
                log.warn("시작 실패 정리 중 Egress 중지 실패(무시) session={}: {}", sessionId, e.getMessage());
            }
        } else if (asset.getStatus() == VideoAssetStatus.STARTING) {
            // StartEgress 응답 유실 뒤 늦게 생성된 원격 작업도 찾아 중지해 다음 attempt와 겹치지 않게 한다.
            try {
                egressControl.findActiveForRoom(LiveSessionRoomNames.of(sessionId))
                        .ifPresent(snapshot -> egressControl.stopRecording(snapshot.egressId()));
            } catch (RuntimeException e) {
                log.warn("시작 결과 미확정 Egress 정리 실패(무시) session={}: {}", sessionId, e.getMessage());
            }
        }
        asset.setStatus(VideoAssetStatus.FAILED);
        asset.setFailureCode(failureCode);
        asset.setRecordingEndedAt(OffsetDateTime.now());
        log.info("시작 실패로 녹화 자산 정리 session={} code={}", sessionId, failureCode);
    }

    /** Gate B~C 조회에 필요한 현재 자산 스냅샷(egressId·bucket·manifest 키). 없으면 empty. */
    @Transactional(readOnly = true, propagation = Propagation.REQUIRES_NEW)
    public Optional<RecordingTarget> findRecordingTarget(UUID sessionId) {
        return videoAssetRepository.findByLiveSessionId(sessionId)
                .map(a -> new RecordingTarget(a.getEgressId(), a.getBucket(), a.getHlsManifestKey(), a.getStatus()));
    }

    /** Egress 준비 확인에 필요한 최소 정보. */
    public record RecordingTarget(String egressId, String bucket, String manifestKey, VideoAssetStatus status) {
    }

    /** 세션 녹화 중지. DB 전이는 짧게 커밋하고, Egress 외부 호출은 트랜잭션 밖에서 수행한다. */
    public void stopRecording(UUID sessionId) {
        RecordingStopStore.StopTarget target = stopStore.prepare(sessionId).orElse(null);
        if (target == null) {
            return;   // 자산 없음 또는 이미 중지·실패 — 멱등
        }
        if (target.egressId() != null) {
            try {
                egressControl.stopRecording(target.egressId());
                log.info("녹화 중지 session={} egressId={}", sessionId, target.egressId());
            } catch (RuntimeException e) {
                log.warn("녹화 중지 실패(무시) session={} egressId={}: {}",
                        sessionId, target.egressId(), e.getMessage());
            }
        }
    }

    /**
     * Egress 완료/실패 webhook을 반영해 자산과 공개 상태를 확정한다(ADR-0034, choinhoo/0007).
     *
     * <p>멱등: 같은 완료 신호가 여러 번 와도 안전하다. 이미 READY/FAILED면 무시한다. 모르는 egressId도
     * 조용히 무시한다(우리 자산이 아님 — 잘못된 실패 표시를 만들지 않는다).
     *
     * <p>완료 신호는 곧바로 READY가 아니라 <b>VERIFYING</b>을 거친다 — 스토리지에 VOD 매니페스트가
     * 실제로 있는지 HEAD로 재확인한다. "COMPLETE인데 파일이 없는" 케이스를 잡기 위함이다.
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
            verifyAndFinalize(asset, egressId, durationMs, sizeBytes, segmentCount);
        } else {
            asset.setStatus(VideoAssetStatus.FAILED);
            asset.setFailureCode(failureCode != null ? failureCode : "EGRESS_FAILED");
            log.warn("녹화 실패 감지 egressId={} code={}", egressId, asset.getFailureCode());
            publishFailed(asset);
        }
    }

    /**
     * VERIFYING: 스토리지에 VOD 매니페스트가 실제로 있는지 확인한 뒤 READY로 확정한다(ADR-0034).
     * <ul>
     *   <li><b>존재</b> → READY + 메타데이터.
     *   <li><b>부재 확정(404)</b> → FAILED({@code MANIFEST_MISSING}). webhook은 COMPLETE라는데 파일이 없다.
     *   <li><b>확인 불가</b>(네트워크·설정 등 예외) → READY로 진행(fail-open). 검증기가 새로운 실패원인이
     *       되지 않도록, webhook의 COMPLETE를 신뢰한다.
     * </ul>
     */
    private void verifyAndFinalize(VideoAsset asset, String egressId,
                                   Long durationMs, Long sizeBytes, Integer segmentCount) {
        asset.setStatus(VideoAssetStatus.VERIFYING);
        String manifestKey = manifestKey(asset.getLiveSessionId());
        boolean present;
        try {
            present = recordingStorage.head(asset.getBucket(), manifestKey).isPresent();
        } catch (RuntimeException e) {
            log.warn("매니페스트 검증 불가 — COMPLETE 신뢰해 READY 유지(fail-open) egressId={} key={}: {}",
                    egressId, manifestKey, e.getMessage());
            markReady(asset, egressId, durationMs, sizeBytes, segmentCount);
            return;
        }
        if (!present) {
            asset.setStatus(VideoAssetStatus.FAILED);
            asset.setFailureCode("MANIFEST_MISSING");
            log.warn("egress COMPLETE인데 매니페스트 부재 → FAILED egressId={} key={}", egressId, manifestKey);
            publishFailed(asset);
            return;
        }
        markReady(asset, egressId, durationMs, sizeBytes, segmentCount);
    }

    private void markReady(VideoAsset asset, String egressId,
                           Long durationMs, Long sizeBytes, Integer segmentCount) {
        OffsetDateTime now = OffsetDateTime.now();
        asset.setStatus(VideoAssetStatus.READY);
        asset.setReadyAt(now);
        asset.setFailureCode(null);
        // 새 정상 녹화만 즉시 공개한다. 이미 READY인 기존 DRAFT는 위 terminal 멱등 가드에서
        // 반환되고, 철회된 자산(WITHDRAWN)과 별도 검수 상태도 여기서 되살리지 않는다.
        boolean autoPublished = asset.getReplayStatus() == ReplayStatus.DRAFT;
        if (autoPublished) {
            asset.setReplayStatus(ReplayStatus.PUBLISHED);
            asset.setPublishedAt(now);
            asset.setPublishedBy(null);     // 시스템 자동 게시
            asset.setWithdrawReason(null);
        }
        if (durationMs != null) {
            asset.setDurationMs(durationMs);
        }
        if (sizeBytes != null) {
            asset.setSizeBytes(sizeBytes);
        }
        if (segmentCount != null) {
            asset.setSegmentCount(segmentCount);
        }
        log.info("녹화 완료 확정 egressId={} durationMs={} size={} replayStatus={}",
                egressId, durationMs, sizeBytes, asset.getReplayStatus());

        eventPublisher.publishEvent(new RecordingReadyEvent(
                asset.getId(), asset.getLessonId(), asset.getLiveSessionId(), asset.getDurationMs(), now));
        /*
         * 자동 공개된 경우에만 학생에게 알린다. 이미 PUBLISHED였거나 철회된 자산은 여기서
         * 되살아나지 않으므로(위 가드), 학생에게 새로 알릴 일도 없다.
         */
        if (autoPublished) {
            eventPublisher.publishEvent(new ReplayPublishedEvent(
                    asset.getId(), asset.getLessonId(), asset.getLiveSessionId(), now));
        }
    }

    /**
     * 실패는 <b>강사만</b> 알아야 한다. 학생에게 "녹화가 실패했습니다"를 보내면 할 수 있는 일이
     * 없는데 불안만 준다 — 다시 찍을 사람은 강사다.
     */
    private void publishFailed(VideoAsset asset) {
        eventPublisher.publishEvent(new RecordingFailedEvent(asset.getId(), asset.getLessonId(),
                asset.getLiveSessionId(), asset.getFailureCode(), OffsetDateTime.now()));
    }

    /** Egress HLS 출력 객체 prefix — 재생 API도 같은 규약을 사용한다. */
    private String objectPrefix(UUID sessionId) {
        return RecordingObjectKeys.objectPrefix(sessionId);
    }

    /** VOD 매니페스트 키 = {@code sessions/{sessionId}/index.m3u8}. Egress가 세그먼트 디렉토리에 playlist를 쓴다. */
    private String manifestKey(UUID sessionId) {
        return RecordingObjectKeys.manifestKey(sessionId, egressProperties.playlistName());
    }
}
