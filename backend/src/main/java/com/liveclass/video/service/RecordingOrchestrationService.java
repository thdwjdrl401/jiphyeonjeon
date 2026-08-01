package com.liveclass.video.service;

import com.liveclass.live.api.LiveRecordingControl;
import com.liveclass.video.domain.VideoAssetStatus;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.UUID;

/**
 * 시작 오케스트레이터가 부르는 동기 녹화 포트 구현(ADR-0002 §4 Gate A~C). live 모듈이 선언한
 * {@link LiveRecordingControl}을 video가 구현해 의존 방향을 video → live 하나로 유지한다.
 *
 * <p>얇은 어댑터다 — 상태기계·트랜잭션은 {@link RecordingService}가 소유하고, 여기서는 그 결과와
 * 저장소 확인을 합쳐 "학생이 지금 재생할 수 있는가"만 판정한다.
 */
@Service
public class RecordingOrchestrationService implements LiveRecordingControl {

    private static final Logger log = LoggerFactory.getLogger(RecordingOrchestrationService.class);

    private final RecordingService recordingService;
    private final EgressControl egressControl;
    private final ReplayStorage replayStorage;
    private final RecordingStorage recordingStorage;
    private final HlsManifestProcessor manifestProcessor;
    private final RecordingStartStore startStore;

    public RecordingOrchestrationService(RecordingService recordingService, EgressControl egressControl,
                                         ReplayStorage replayStorage, RecordingStorage recordingStorage,
                                         HlsManifestProcessor manifestProcessor,
                                         RecordingStartStore startStore) {
        this.recordingService = recordingService;
        this.egressControl = egressControl;
        this.replayStorage = replayStorage;
        this.recordingStorage = recordingStorage;
        this.manifestProcessor = manifestProcessor;
        this.startStore = startStore;
    }

    @Override
    public boolean startRecording(UUID sessionId, UUID lessonId, String roomName) {
        return recordingService.startRecording(sessionId, lessonId, roomName);
    }

    @Override
    public EgressReadiness pollReadiness(UUID sessionId) {
        RecordingService.RecordingTarget target = recordingService.findRecordingTarget(sessionId).orElse(null);
        if (target == null) {
            return new EgressReadiness(false, false, true, "EGRESS_NOT_STARTED");
        }
        if (target.status() == VideoAssetStatus.FAILED) {
            return new EgressReadiness(false, false, true, "EGRESS_START_FAILED");
        }
        if (target.egressId() == null) {
            // StartEgress 응답 유실 경로: 같은 room의 유일한 STARTING/ACTIVE 작업을 찾아 ID를 복구한다.
            try {
                Optional<EgressControl.EgressSnapshot> discovered =
                        egressControl.findActiveForRoom(LiveSessionRoomNames.of(sessionId));
                if (discovered.isEmpty()) {
                    return new EgressReadiness(false, false, false, null);
                }
                startStore.attachEgress(sessionId, discovered.get().egressId());
                target = recordingService.findRecordingTarget(sessionId).orElse(null);
                if (target == null || target.egressId() == null) {
                    return new EgressReadiness(false, false, false, null);
                }
            } catch (RuntimeException e) {
                log.debug("Egress 시작 결과 재조정 실패 — 계속 대기 session={}: {}", sessionId, e.getMessage());
                return new EgressReadiness(false, false, false, null);
            }
        }

        EgressControl.EgressState state;
        try {
            state = egressControl.findState(target.egressId()).orElse(EgressControl.EgressState.UNKNOWN);
        } catch (RuntimeException e) {
            // 단일 poll 실패로 자산을 FAILED로 만들지 않는다(ADR §4). timeout과 명시적 terminal만 실패다.
            log.debug("Egress 상태 조회 실패 — 계속 대기 session={}: {}", sessionId, e.getMessage());
            return new EgressReadiness(false, false, false, null);
        }
        if (state.terminalFailure()) {
            return new EgressReadiness(false, false, true, state.name());
        }
        if (state != EgressControl.EgressState.EGRESS_ACTIVE) {
            return new EgressReadiness(false, false, false, null);   // STARTING 등 — timeout까지 기다린다.
        }
        return new EgressReadiness(true, manifestPlayable(target), false, null);
    }

    @Override
    public void abortRecording(UUID sessionId, String failureCode) {
        try {
            recordingService.abortRecording(sessionId, failureCode);
        } catch (RuntimeException e) {
            log.warn("녹화 정리 실패(무시) session={}: {}", sessionId, e.getMessage());
        }
    }

    @Override
    public void stopRecording(UUID sessionId) {
        recordingService.stopRecording(sessionId);
    }

    /**
     * Gate C — 학생 재생 가능. manifest가 존재하고 {@code #EXTM3U}로 파싱되며, media URI를 하나 이상 갖고,
     * 그 첫 세그먼트가 같은 버킷에 실재하고, 아직 {@code #EXT-X-ENDLIST}가 없어야 한다.
     * 기존 매니페스트 파서·객체 키 규약을 그대로 재사용한다(ADR §4).
     */
    private boolean manifestPlayable(RecordingService.RecordingTarget target) {
        String manifest;
        try {
            manifest = replayStorage.findManifest(target.bucket(), target.manifestKey()).orElse(null);
        } catch (RuntimeException e) {
            log.debug("Egress manifest 조회 실패 — 계속 대기 key={}: {}", target.manifestKey(), e.getMessage());
            return false;
        }
        if (manifest == null || !manifestProcessor.isLive(manifest)) {
            return false;   // 아직 없거나, 이미 ENDLIST가 붙어 라이브 준비 단계의 재생목록이 아니다.
        }
        Optional<String> segmentKey = manifestProcessor.firstSegmentKey(manifest, target.manifestKey());
        if (segmentKey.isEmpty()) {
            return false;
        }
        try {
            return recordingStorage.head(target.bucket(), segmentKey.get()).isPresent();
        } catch (RuntimeException e) {
            log.debug("첫 세그먼트 확인 실패 — 계속 대기 key={}: {}", segmentKey.get(), e.getMessage());
            return false;
        }
    }
}
