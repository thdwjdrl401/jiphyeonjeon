package com.liveclass.learning.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import com.liveclass.learning.service.WatchHeatmapService;
import jakarta.validation.constraints.AssertTrue;
import jakarta.validation.constraints.NotNull;

import java.util.Map;

/**
 * 구간별 시청 횟수 보고. <b>누적 절대값</b>을 보낸다 — 증분이면 재전송마다 횟수가 부풀어
 * 그래프가 조용히 왜곡된다.
 *
 * @param bucketSizeMs 클라이언트가 쓴 칸 길이. 서버 계약과 다르면 거절한다 — 칸 번호가 다른 구간을
 *                     가리키게 되어 과거 기록과 섞이면 알아채기 어렵다.
 * @param counts       {@code {칸번호: 재생횟수}}. 이번에 본 칸만 담아도 되고 전부 담아도 된다.
 */
@Schema(description = "구간별 시청 횟수(누적 절대값)")
public record WatchBucketReportRequest(

        @Schema(description = "칸 길이(ms). 계약 고정값과 같아야 한다.", example = "10000")
        @NotNull
        Integer bucketSizeMs,

        @Schema(description = "칸번호 → 재생횟수. 2 이상이 재시청이다.")
        @NotNull
        Map<Integer, Integer> counts) {

    /**
     * 칸 길이가 계약과 다르면 거절한다. 검증으로 두는 이유는 400으로 나가야 하기 때문이다 —
     * 예외를 직접 던지면 500이 되어 "클라이언트가 잘못 보냈다"는 사실이 서버 오류로 보인다.
     */
    @AssertTrue(message = "지원하지 않는 칸 길이입니다.")
    @com.fasterxml.jackson.annotation.JsonIgnore
    public boolean isSupportedBucketSize() {
        return bucketSizeMs != null && bucketSizeMs == WatchHeatmapService.BUCKET_SIZE_MS;
    }
}
