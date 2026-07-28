package com.liveclass.video.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 라이브 되감기와 종료 후 VOD가 공유하는 재생 metadata(choinhoo/0001).
 *
 * <p>source가 하나인 이유: 라이브 중 재생목록은 {@code #EXT-X-ENDLIST} 없이 자라는 EVENT 목록이라
 * 그 자체로 라이브 엣지와 세션 처음까지의 seek을 동시에 준다. 크기는 델타 재생목록으로 잡으므로
 * 별도의 엣지 전용 source가 필요 없다.
 */
@Schema(description = "HLS 재생 metadata. source URL은 인증된 manifest 엔드포인트다.")
public record PlaybackResponse(
        UUID lessonId,
        UUID videoAssetId,
        UUID sessionId,
        OffsetDateTime startedAt,
        String liveSessionStatus,
        @Schema(description = "재생 가능한 최신 지점(세션 상대 ms). 라이브 엣지.")
        Long currentSessionMs,
        @Schema(description = "첫 PDT − 세션 시작시각(ms). 자막 싱크 기준. 구할 수 없으면 null.")
        Long sessionOffsetMs,
        @Schema(description = "종료된 녹화의 총 길이(ms). 라이브 중에는 null.")
        Long durationMs,
        @Schema(description = "재생 source. manifest가 아직 없으면(Egress 지연) null.")
        Source source
) {
    public record Source(
            String url,
            @Schema(description = "되감기 가능한 시작 지점(세션 상대 ms)")
            Long availableFromMs,
            @Schema(description = "되감기 가능한 끝 지점(세션 상대 ms)")
            Long availableToMs
    ) {
    }
}
