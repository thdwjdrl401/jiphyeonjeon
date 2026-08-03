package com.liveclass.learning.web.dto;

import com.liveclass.learning.service.WatchHeatmapService;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

/**
 * 재생바 위에 그릴 "많이 다시 본 구간" 그래프.
 *
 * <p>절대 횟수가 아니라 <b>도달한 사람 수로 나눈 강도</b>다 — 합만 그리면 뒤로 갈수록 이탈자가 늘어
 * 재시청과 무관하게 우하향 그래프가 나온다.
 */
@Schema(description = "구간별 재시청 강도. 1.0이면 도달한 사람이 평균 한 번, 2.0이면 두 번 봤다.")
public record WatchHeatmapResponse(

        @Schema(description = "저장 칸 길이(ms). 점 하나가 몇 초인지 계산할 때 쓴다.", example = "10000")
        int bucketSizeMs,

        @Schema(description = "0.0 이상의 강도 배열. 강의 길이와 무관하게 최대 100점으로 묶어 준다.")
        List<Double> points,

        @Schema(description = "가장 많은 사람이 도달한 칸의 인원. 그래프를 얼마나 믿을지 화면이 판단한다.")
        long viewers) {

    public static WatchHeatmapResponse from(WatchHeatmapService.Heatmap heatmap) {
        return new WatchHeatmapResponse(heatmap.bucketSizeMs(), heatmap.points(), heatmap.viewers());
    }
}
