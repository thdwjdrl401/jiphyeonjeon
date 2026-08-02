package com.liveclass.video.service;

import com.liveclass.live.api.LiveRecordingStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;
import java.util.UUID;

/**
 * 녹화 자산 조회 포트 구현. live 모듈이 선언한 {@link LiveRecordingStatus}를 video가 구현해
 * 의존 방향을 video → live 하나로 유지한다.
 *
 * <p>읽기 전용 어댑터다 — 상태를 바꾸지 않는다. 처리 현황은 <b>지금 저장된 사실</b>을 보여주는 화면이고,
 * 상태 전이는 시작 오케스트레이터와 Egress 완료 webhook만 한다.
 */
@Service
public class RecordingStatusService implements LiveRecordingStatus {

    private final VideoAssetRepository videoAssetRepository;

    public RecordingStatusService(VideoAssetRepository videoAssetRepository) {
        this.videoAssetRepository = videoAssetRepository;
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<RecordingStatusView> findBySession(UUID sessionId) {
        return videoAssetRepository.findByLiveSessionId(sessionId)
                .map(a -> new RecordingStatusView(
                        a.getId(),
                        a.getStatus().name(),
                        a.getReplayStatus() == null ? null : a.getReplayStatus().name(),
                        a.getFailureCode(),
                        a.getDurationMs(),
                        a.getSizeBytes(),
                        a.getRecordingStartedAt(),
                        a.getRecordingEndedAt()));
    }
}
