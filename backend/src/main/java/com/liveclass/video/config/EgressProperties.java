package com.liveclass.video.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Egress HLS 출력(S3/MinIO) 설정 (infra/livekit/request-hls.json과 대응). 시크릿(accessKey·secret)은
 * 환경변수로 주입하고 dev 기본값만 여기 둔다. LiveKit 서버 접속(url·key·secret)은 {@code livekit.*}를 재사용한다.
 */
@ConfigurationProperties("livekit.egress")
public record EgressProperties(
        String bucket,
        String s3Endpoint,
        String s3AccessKey,
        String s3Secret,
        String s3Region,
        boolean forcePathStyle,
        int segmentDurationSeconds,
        String playlistName,
        String livePlaylistName,
        String layout,
        int playbackUrlTtlSeconds
) {
}
