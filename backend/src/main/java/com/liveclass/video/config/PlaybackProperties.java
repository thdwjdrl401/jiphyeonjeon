package com.liveclass.video.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

import java.time.Duration;

/**
 * 다시보기 읽기 정책. Egress 출력 설정({@code livekit.egress.*})과 분리해 재생 쪽 값만 소유한다.
 *
 * <p><b>{@code publicEndpoint}가 왜 따로 있나</b>: {@code livekit.egress.s3-endpoint}는 Egress가
 * 업로드하고 백엔드가 매니페스트를 읽는 <b>내부</b> 주소다(운영에서 {@code http://minio:9000}).
 * 반면 매니페스트 안의 세그먼트 presigned URL은 <b>브라우저가</b> 여는 주소라 공개 도메인이어야 한다.
 * SigV4 서명은 Host를 포함하므로 서명 시점에 브라우저가 보낼 Host로 서명해야 하고, 그래서 두 주소를
 * 나눈다. 에셋 모듈({@code asset.storage.endpoint})은 업로드도 브라우저가 해서 이 구분이 없었다.
 *
 * <p>비워두면 내부 주소로 서명한다 — 단일 호스트 개발 환경에서 그대로 동작한다.
 */
@ConfigurationProperties("video.playback")
public record PlaybackProperties(
        Duration segmentUrlTtl,
        String publicEndpoint
) {
    private static final Duration DEFAULT_SEGMENT_URL_TTL = Duration.ofHours(1);

    public PlaybackProperties {
        if (segmentUrlTtl == null) {
            segmentUrlTtl = DEFAULT_SEGMENT_URL_TTL;
        }
        if (segmentUrlTtl.isZero() || segmentUrlTtl.isNegative()) {
            throw new IllegalArgumentException("video.playback.segment-url-ttl은 양수여야 합니다.");
        }
        if (publicEndpoint != null && publicEndpoint.isBlank()) {
            publicEndpoint = null;
        }
    }
}
