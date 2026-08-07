package com.liveclass.live.api;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

/**
 * 녹화 자산의 <b>읽기</b> 포트. 종료 후 처리 현황 화면이 쓴다.
 *
 * <p><b>{@link LiveRecordingControl}과 분리한 이유</b>: 그쪽은 시작·중지 오케스트레이션이 필요로 하는
 * 제어 포트이고, 이건 강사에게 진행 상황을 <b>보여주기 위한</b> 조회다. 한 인터페이스에 섞으면 화면이
 * 제어 메서드까지 들고 있게 된다.
 *
 * <p><b>왜 포트가 live 쪽에 있는가</b>: {@link LiveRecordingControl}과 같은 이유다 — video는 이미
 * {@code live.api}에 의존하므로, live가 {@code video.api}를 참조하면 두 모듈이 순환해 Modulith 경계
 * 검증이 깨진다. 포트를 소비자(live)에 두고 video가 구현해 의존 방향을 video → live 하나로 유지한다.
 */
public interface LiveRecordingStatus {

    /**
     * 세션의 녹화 자산 상태. 자산이 없으면 empty — 녹화를 켜지 않았거나 아직 시작 전이다.
     * 그 부재를 "실패"로 바꾸지 않는다. 화면이 "녹화 없음"으로 옮긴다.
     */
    Optional<RecordingStatusView> findBySession(UUID sessionId);

    /**
     * 처리 현황이 필요로 하는 만큼만 담는다. HLS 키·버킷 같은 저장소 내부는 내보내지 않는다 —
     * 화면이 알 필요가 없고, 재생은 별도 playback 계약이 담당한다.
     *
     * @param status       {@code STARTING|RECORDING|FINALIZING|VERIFYING|READY|FAILED}
     * @param replayStatus {@code DRAFT|PUBLISHED|WITHDRAWN} — 자산 준비와 <b>다른 축</b>이다.
     *                     새 정상 녹화는 READY와 PUBLISHED를 함께 확정하지만 기존 미게시·철회 자산은
     *                     수동 게시 상태로 남을 수 있다.
     * @param failureCode  {@code status=FAILED}일 때의 안정적인 code. 아니면 null
     * @param durationMs   녹화 길이. 완료 webhook 전에는 null
     * @param sizeBytes    총 크기. 완료 webhook 전에는 null
     */
    record RecordingStatusView(
            UUID videoAssetId,
            String status,
            String replayStatus,
            String failureCode,
            Long durationMs,
            Long sizeBytes,
            OffsetDateTime recordingStartedAt,
            OffsetDateTime recordingEndedAt) {
    }
}
