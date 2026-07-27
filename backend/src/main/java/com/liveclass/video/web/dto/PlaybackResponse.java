package com.liveclass.video.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;
import java.util.UUID;

/** 라이브 되감기와 종료 후 VOD가 공유하는 재생 metadata(choinhoo/0001). */
@Schema(description = "HLS recent/dvr 재생 metadata. source URL은 인증된 manifest 엔드포인트다.")
public record PlaybackResponse(
        UUID lessonId,
        UUID videoAssetId,
        UUID sessionId,
        OffsetDateTime startedAt,
        String liveSessionStatus,
        Long currentSessionMs,
        Long sessionOffsetMs,
        Long durationMs,
        Sources sources
) {
    public record Sources(
            Source recent,
            Source dvr
    ) {
    }

    public record Source(
            String url,
            Long availableFromMs,
            Long availableToMs
    ) {
    }
}
