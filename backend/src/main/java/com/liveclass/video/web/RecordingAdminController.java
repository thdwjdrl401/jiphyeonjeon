package com.liveclass.video.web;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import com.liveclass.video.service.EgressControl;
import com.liveclass.video.service.EgressControlException;
import com.liveclass.video.service.RecordingService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.time.OffsetDateTime;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;

/**
 * 운영 콘솔의 녹화 현황(읽기 전용). ADMIN 전용 경로({@code /api/admin/**}, SecurityConfig).
 *
 * <p>여기서 답하려는 질문은 하나다 — <b>녹화가 실제로 끝나고 있는가?</b> 자산은 RECORDING → FINALIZING →
 * READY로 가는데, 완료 확정은 LiveKit egress webhook이 와야 일어난다. 그 webhook이 오지 않으면 자산이
 * FINALIZING에 영원히 머무는데, 화면에는 "처리 중"으로만 보여서 정상과 구분되지 않는다. 실제로 READY가
 * <b>한 건도</b> 없이 FINALIZING만 쌓여 있는 것을 DB를 직접 열어 보고서야 알았다.
 *
 * <p>그래서 상태 분포와 <b>가장 오래 멈춘 자산의 나이</b>를 같이 준다 — 정체는 개수가 아니라 시간으로
 * 드러난다. 판정(몇 분이면 이상인가)은 화면이 한다. 여기서는 사실만 준다.
 *
 * <p>모듈 경계상 이 endpoint는 video 모듈이 <b>자기 데이터만</b> 노출한다. 대시보드가 필요로 하는 다른
 * 축(outbox·라이브 세션 등)은 각 모듈이 각자 노출하고 화면이 합친다 — 한 곳에서 전부 조회하면 admin이
 * 모든 모듈을 알게 된다.
 */
@RestController
@RequestMapping("/api/admin/recordings")
public class RecordingAdminController {

    private static final Logger log = LoggerFactory.getLogger(RecordingAdminController.class);

    private final VideoAssetRepository repository;
    private final EgressControl egressControl;
    private final RecordingService recordingService;

    public RecordingAdminController(VideoAssetRepository repository,
                                    EgressControl egressControl,
                                    RecordingService recordingService) {
        this.repository = repository;
        this.egressControl = egressControl;
        this.recordingService = recordingService;
    }

    @GetMapping("/summary")
    public RecordingSummary summary() {
        Map<VideoAssetStatus, Long> counts = new EnumMap<>(VideoAssetStatus.class);
        for (VideoAssetStatus status : VideoAssetStatus.values()) {
            counts.put(status, 0L);
        }
        for (Object[] row : repository.countByStatus()) {
            counts.put((VideoAssetStatus) row[0], (Long) row[1]);
        }
        OffsetDateTime oldestFinalizingAt = repository
                .findFirstByStatusOrderByCreatedAtAsc(VideoAssetStatus.FINALIZING)
                .map(VideoAsset::getCreatedAt)
                .orElse(null);
        return new RecordingSummary(
                counts.entrySet().stream()
                        .map(e -> new StatusCount(e.getKey().name(), e.getValue()))
                        .toList(),
                oldestFinalizingAt);
    }

    /**
     * 멈춘 자산을 <b>LiveKit에 직접 물어</b> 확정한다.
     *
     * <p>완료 확정은 원래 egress webhook이 한다. 그 경로가 끊기면(설정 누락·네트워크 등) 자산은 영원히
     * FINALIZING에 남고, 지나간 이벤트는 다시 오지 않으므로 webhook을 고쳐도 <b>과거 건은 복구되지 않는다.</b>
     * 그래서 서버에 결과를 물어 같은 확정 경로({@code completeFromWebhook})로 흘린다 — 확정 로직이 두 벌이
     * 되면 webhook 경로와 값이 갈라진다.
     *
     * <p>아직 진행 중인 Egress는 건드리지 않는다(끝나면 정상 경로로 확정된다). LiveKit이 모르는 작업은
     * 실패로 단정하지 않고 {@code unknown}으로 보고만 한다 — 보존 기간이 지나 목록에서 빠졌을 수 있고,
     * 그걸 FAILED로 굳히면 실제로는 재생 가능한 녹화를 잃는다.
     */
    @PostMapping("/reconcile")
    public ReconcileResult reconcile() {
        List<VideoAsset> stuck = repository.findByStatusOrderByCreatedAtAsc(VideoAssetStatus.FINALIZING);
        int completed = 0;
        int failed = 0;
        int stillRunning = 0;
        int unknown = 0;
        for (VideoAsset asset : stuck) {
            String egressId = asset.getEgressId();
            if (egressId == null || egressId.isBlank()) {
                unknown++;
                continue;
            }
            var found = egressControl.findResult(egressId);
            if (found.isEmpty()) {
                unknown++;
                continue;
            }
            EgressControl.EgressResult result = found.get();
            if (result.state() == EgressControl.EgressState.EGRESS_COMPLETE) {
                recordingService.completeFromWebhook(egressId, true,
                        result.durationMs(), result.sizeBytes(), result.segmentCount(), null);
                completed++;
            } else if (result.state().terminalFailure()) {
                String error = result.error() == null || result.error().isBlank()
                        ? "EGRESS_FAILED" : "EGRESS_FAILED: " + result.error();
                recordingService.completeFromWebhook(egressId, false, null, null, null, error);
                failed++;
            } else {
                stillRunning++;
            }
        }
        log.info("녹화 보정 실행 대상={} 완료={} 실패={} 진행중={} 미확인={}",
                stuck.size(), completed, failed, stillRunning, unknown);
        return new ReconcileResult(stuck.size(), completed, failed, stillRunning, unknown);
    }

    /** LiveKit 통신 실패는 502로 — 서버 버그가 아니라 업스트림 문제임을 알린다. */
    @ExceptionHandler(EgressControlException.class)
    public ResponseEntity<ErrorResponse> handleControl(EgressControlException e) {
        log.warn("녹화 보정 실패: {}", e.getMessage());
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(ErrorResponse.of("EGRESS_CONTROL_FAILED", e.getMessage()));
    }

    /**
     * @param byStatus           상태별 자산 수(0인 상태도 포함 — "READY가 0건"이 보여야 한다)
     * @param oldestFinalizingAt 가장 오래 FINALIZING인 자산의 생성 시각. 없으면 null
     */
    public record RecordingSummary(List<StatusCount> byStatus, OffsetDateTime oldestFinalizingAt) {
    }

    public record StatusCount(String status, long count) {
    }

    /**
     * @param checked      확인한 FINALIZING 자산 수
     * @param completed    READY로 확정한 수
     * @param failed       FAILED로 확정한 수
     * @param stillRunning 아직 진행 중이라 두고 온 수
     * @param unknown      LiveKit이 모르는 작업(단정하지 않고 보고만 한다)
     */
    public record ReconcileResult(int checked, int completed, int failed, int stillRunning, int unknown) {
    }
}
