package com.liveclass.live.web.dto;

import com.liveclass.live.api.LiveRecordingStatus;
import com.liveclass.live.service.LiveProcessingService;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;

/**
 * 종료 후 처리 현황 응답(CONTRACT §2-2).
 *
 * <p><b>표시 문구를 담지 않는다.</b> 서버는 상태만 주고 "HLS 세그먼트 정리 중" 같은 문장은 FE가 고른다.
 * 문구를 계약에 넣으면 한 줄 고치는 데 서버 배포가 필요해진다.
 *
 * <p><b>준비와 게시를 하나로 접지 않는다.</b> {@code videoAsset.status=READY}는 "영상을 재생할 수 있다"이고
 * {@code replayStatus=PUBLISHED}는 "수강생에게 공개했다"이다. 새 정상 녹화는 둘을 한 트랜잭션에서
 * 확정하지만 기존 미게시·철회 자산에는 다른 조합이 남을 수 있다(ADR-0059, choinhoo/0007).
 */
@Schema(description = "종료 후 녹화 처리 현황. 라이브 상태와 녹화 자산 상태는 별개로 움직인다.")
public record LiveProcessingResponse(

        @Schema(example = "0f6f1d0e-7a3d-4a0c-9a1e-1f2a3b4c5d6e")
        String sessionId,

        @Schema(description = "라이브 세션 상태. 종료 화면에서는 보통 ENDED다.", example = "ENDED")
        String liveSessionStatus,

        @Schema(description = "이 세션이 녹화를 켜고 진행했는가. videoAsset이 null일 때 "
                + "'아직 안 만들어졌다'와 '애초에 녹화하지 않았다'를 구분한다.")
        boolean recordingEnabled,

        OffsetDateTime startedAt,

        OffsetDateTime endedAt,

        @Schema(description = "녹화 자산. 없으면 null.")
        VideoAsset videoAsset) {

    @Schema(description = "녹화 자산 상태. 라이브 종료와 무관하게 Egress 완료 webhook이 진행시킨다.")
    public record VideoAsset(

            String videoAssetId,

            @Schema(description = "STARTING·RECORDING·FINALIZING·VERIFYING·READY·FAILED",
                    example = "READY")
            String status,

            @Schema(description = "DRAFT·PUBLISHED·WITHDRAWN. 자산 준비와 다른 축이다.",
                    example = "DRAFT")
            String replayStatus,

            @Schema(description = "status=FAILED일 때의 안정적인 code. 아니면 null.", example = "EGRESS_FAILED")
            String failureCode,

            @Schema(description = "녹화 길이(ms). 완료 webhook 전에는 null.")
            Long durationMs,

            @Schema(description = "총 크기(bytes). 완료 webhook 전에는 null.")
            Long sizeBytes,

            OffsetDateTime recordingStartedAt,

            OffsetDateTime recordingEndedAt) {
    }

    public static LiveProcessingResponse from(LiveProcessingService.LiveProcessingView view) {
        LiveRecordingStatus.RecordingStatusView a = view.videoAsset();
        return new LiveProcessingResponse(
                view.sessionId().toString(),
                view.liveSessionStatus(),
                view.recordingEnabled(),
                view.startedAt(),
                view.endedAt(),
                a == null ? null : new VideoAsset(
                        a.videoAssetId().toString(),
                        a.status(),
                        a.replayStatus(),
                        a.failureCode(),
                        a.durationMs(),
                        a.sizeBytes(),
                        a.recordingStartedAt(),
                        a.recordingEndedAt()));
    }
}
