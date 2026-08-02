package com.liveclass.video.web;

import com.liveclass.video.domain.VideoAsset;
import com.liveclass.video.domain.VideoAssetStatus;
import com.liveclass.video.repository.VideoAssetRepository;
import org.springframework.web.bind.annotation.GetMapping;
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

    private final VideoAssetRepository repository;

    public RecordingAdminController(VideoAssetRepository repository) {
        this.repository = repository;
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
     * @param byStatus           상태별 자산 수(0인 상태도 포함 — "READY가 0건"이 보여야 한다)
     * @param oldestFinalizingAt 가장 오래 FINALIZING인 자산의 생성 시각. 없으면 null
     */
    public record RecordingSummary(List<StatusCount> byStatus, OffsetDateTime oldestFinalizingAt) {
    }

    public record StatusCount(String status, long count) {
    }
}
