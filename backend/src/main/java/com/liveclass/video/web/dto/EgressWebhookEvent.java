package com.liveclass.video.web.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;

import java.util.List;

/**
 * LiveKit webhook 본문(필요 필드만). LiveKit이 보내는 protobuf-JSON은 camelCase다.
 * 알 수 없는 필드는 무시한다 — LiveKit이 필드를 늘려도 깨지지 않도록.
 *
 * <p>한 타입으로 여러 이벤트를 받는다. 이벤트에 따라 채워지는 자리가 다르다 —
 * {@code egress_ended}는 {@link EgressInfo}를, {@code room_finished}는 {@link RoomInfo}를 싣는다.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record EgressWebhookEvent(
        String event,
        EgressInfo egressInfo,
        RoomInfo room
) {

    /** {@code room_finished}가 알려 주는 방. 우리가 쓰는 것은 이름 하나다(방 이름이 곧 세션 식별자). */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record RoomInfo(String sid, String name) {
    }

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
