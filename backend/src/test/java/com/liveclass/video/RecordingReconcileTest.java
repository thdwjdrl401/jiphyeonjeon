package com.liveclass.video;

import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.service.EgressControl;
import com.liveclass.video.service.RecordingService;
import com.liveclass.video.web.RecordingAdminController;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Optional;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 멈춘 녹화 보정의 <b>판정 규칙</b>(운영 콘솔).
 *
 * <p>완료 확정은 원래 egress webhook이 한다. 그 경로가 끊기면 자산이 FINALIZING에 남는데, <b>지나간
 * webhook은 다시 오지 않으므로</b> 설정을 고쳐도 과거 건은 복구되지 않는다. 보정이 그 유일한 복구 경로다.
 *
 * <p>여기서 못 박는 것은 <b>덜 하는 쪽</b>이다 — LiveKit이 모르는 작업을 실패로 단정하면 실제로는 재생
 * 가능한 녹화를 잃는다. 진행 중인 것도 건드리지 않는다(끝나면 정상 경로가 확정한다).
 *
 * <p>DB 없이 규칙만 검증한다. video_asset은 live_session FK를 요구해 fixture를 만들려면 세션까지 실제로
 * 만들어야 하는데, 그 무게는 여기서 확인하려는 것(어떤 상태에서 확정하는가)과 무관하다.
 */
class RecordingReconcileTest {

    private final VideoAssetRepository repository = mock(VideoAssetRepository.class);
    private final EgressControl egressControl = mock(EgressControl.class);
    private final RecordingService recordingService = mock(RecordingService.class);
    private final RecordingAdminController controller =
            new RecordingAdminController(repository, egressControl, recordingService);

    private void givenStuck(String egressId) {
        VideoAsset asset = new VideoAsset();
        asset.setEgressId(egressId);
        asset.setStatus(VideoAssetStatus.FINALIZING);
        when(repository.findByStatusOrderByCreatedAtAsc(VideoAssetStatus.FINALIZING)).thenReturn(List.of(asset));
    }

    @Test
    void unknown_egress_is_reported_but_never_finalized() {
        givenStuck("eg_unknown");
        when(egressControl.findResult(any())).thenReturn(Optional.empty());   // LiveKit이 모르는 작업

        var result = controller.reconcile();

        assertThat(result.unknown()).isEqualTo(1);
        verify(recordingService, never()).completeFromWebhook(any(), anyBoolean(), any(), any(), any(), any());
    }

    @Test
    void asset_without_egress_id_is_reported_but_never_finalized() {
        givenStuck(null);

        var result = controller.reconcile();

        assertThat(result.unknown()).isEqualTo(1);
        verify(recordingService, never()).completeFromWebhook(any(), anyBoolean(), any(), any(), any(), any());
    }

    @Test
    void still_running_egress_is_left_alone() {
        givenStuck("eg_running");
        when(egressControl.findResult(any())).thenReturn(Optional.of(new EgressControl.EgressResult(
                EgressControl.EgressState.EGRESS_ACTIVE, null, null, null, null)));

        var result = controller.reconcile();

        assertThat(result.stillRunning()).isEqualTo(1);
        verify(recordingService, never()).completeFromWebhook(any(), anyBoolean(), any(), any(), any(), any());
    }

    @Test
    void completed_egress_is_finalized_with_segment_metadata() {
        givenStuck("eg_done");
        when(egressControl.findResult(any())).thenReturn(Optional.of(new EgressControl.EgressResult(
                EgressControl.EgressState.EGRESS_COMPLETE, 61_000L, 2_048L, 7, null)));

        var result = controller.reconcile();

        assertThat(result.completed()).isEqualTo(1);
        // 길이·크기·세그먼트 수까지 함께 넘긴다 — 상태만 바꾸면 자산이 READY인데 재생 메타가 빈다.
        verify(recordingService).completeFromWebhook("eg_done", true, 61_000L, 2_048L, 7, null);
    }

    @Test
    void terminal_failure_is_finalized_as_failed_with_reason() {
        givenStuck("eg_failed");
        when(egressControl.findResult(any())).thenReturn(Optional.of(new EgressControl.EgressResult(
                EgressControl.EgressState.EGRESS_FAILED, null, null, null, "disk full")));

        var result = controller.reconcile();

        assertThat(result.failed()).isEqualTo(1);
        verify(recordingService).completeFromWebhook(eq("eg_failed"), eq(false), any(), any(), any(),
                eq("EGRESS_FAILED: disk full"));
    }
}
