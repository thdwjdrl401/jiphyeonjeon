package com.liveclass.video.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/** 다시보기 읽기 정책. Egress 출력 설정과 분리해 세그먼트 presigned URL TTL만 소유한다. */
@ConfigurationProperties("video.playback")
public record PlaybackProperties(
        Duration segmentUrlTtl
) {
    private static final Duration DEFAULT_SEGMENT_URL_TTL = Duration.ofHours(1);

    public PlaybackProperties {
        if (segmentUrlTtl == null) {
            segmentUrlTtl = DEFAULT_SEGMENT_URL_TTL;
        }
        if (segmentUrlTtl.isZero() || segmentUrlTtl.isNegative()) {
            throw new IllegalArgumentException("video.playback.segment-url-ttl은 양수여야 합니다.");
        }
    }
}
