package com.liveclass.live.web.dto;

import com.liveclass.live.service.LiveRoomControl;
import io.swagger.v3.oas.annotations.media.Schema;

@Schema(description = "방 참여자")
public record ParticipantView(

        @Schema(description = "참여자 식별자(입장 토큰의 identity)")
        String identity,

        @Schema(description = "표시 이름")
        String name,

        @Schema(description = "연결 상태", example = "ACTIVE")
        String state,

        @Schema(description = "입장 시각(epoch seconds)")
        long joinedAtEpochSeconds
) {

    public static ParticipantView from(LiveRoomControl.RoomParticipant p) {
        return new ParticipantView(p.identity(), p.name(), p.state(), p.joinedAtEpochSeconds());
    }
}
