package com.liveclass.video.web.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * LiveKit egress webhook 본문(필요 필드만). LiveKit이 보내는 protobuf-JSON은 camelCase다.
 * 알 수 없는 필드는 무시한다 — LiveKit이 필드를 늘려도 깨지지 않도록.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record EgressWebhookEvent(
        String event,
        EgressInfo egressInfo
) {

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record EgressInfo(
            String egressId,
            String status,
            String error,
            List<SegmentResult> segmentResults
    ) {
    }

    /**
     * 세그먼트 출력 결과. int64 필드(duration·size)는 proto-JSON에서 문자열로 온다.
     * duration은 <b>나노초</b>다.
     */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record SegmentResult(
            String playlistName,
            String duration,
            String size,
            Integer segmentCount
    ) {
    }
}
