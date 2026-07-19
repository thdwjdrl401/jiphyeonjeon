package com.liveclass.live.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.Instant;

/** LiveKit 토큰 응답 (LIVE-SESSION-07, FE 명세 형태). */
@Schema(description = "LiveKit 입장 토큰")
public record LiveTokenResponse(

        @Schema(description = "연결 종류", example = "LIVEKIT")
        String connectionType,

        @Schema(description = "LiveKit 접속 wss URL")
        String livekitUrl,

        @Schema(description = "서명된 단명 토큰(JWT)")
        String accessToken,

        @Schema(description = "토큰 만료 시각")
        Instant expiresAt,

        Participant participant,

        Grants grants
) {

    @Schema(description = "참여자")
    public record Participant(String identity, String displayName) {
    }

    @Schema(description = "허용 권한")
    public record Grants(boolean canSubscribe, boolean canPublish, boolean canPublishData) {
    }
}
