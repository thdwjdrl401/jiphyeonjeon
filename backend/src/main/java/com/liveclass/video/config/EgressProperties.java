package com.liveclass.video.config;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * Egress HLS 출력(S3/MinIO) 설정 (infra/livekit/request-hls.json과 대응). 시크릿(accessKey·secret)은
 * 환경변수로 주입하고 dev 기본값만 여기 둔다. LiveKit 서버 접속(url·key·secret)은 {@code livekit.*}를 재사용한다.
 *
 * <p><b>주소가 셋인 이유</b>: 같은 버킷을 세 주체가 서로 다른 위치에서 접근한다.
 * <ul>
 *   <li>{@code s3Endpoint} — 백엔드가 매니페스트를 읽는 <b>내부</b> 주소(운영: {@code http://minio:9000})
 *   <li>{@code uploadEndpoint} — <b>Egress</b>가 세그먼트를 올릴 주소. Egress는 호스트 네트워크로
 *       돌아 도커 서비스명({@code minio})을 해석하지 못하므로 호스트에서 닿는 주소여야 한다.
 *   <li>{@code video.playback.public-endpoint} — <b>브라우저</b>가 여는 presigned URL 서명 주소
 * </ul>
 * 하나로 합칠 수 없다. SigV4가 Host를 서명에 포함하고, 세 주체의 네트워크 위치가 다르다.
 */
@ConfigurationProperties("livekit.egress")
public record EgressProperties(
        String bucket,
        String s3Endpoint,
        String uploadEndpoint,
        String s3AccessKey,
        String s3Secret,
        String s3Region,
        boolean forcePathStyle,
        int segmentDurationSeconds,
        String playlistName,
        String livePlaylistName,
        String layout,

        /**
         * 합성 출력 해상도. 안 주면 Egress 기본값이 720p라, 강사가 1080p로 올려도 다운스케일돼
         * 코드·슬라이드 글자가 뭉갠다(EC2 실측).
         */
        int encodingWidth,
        int encodingHeight,

        /**
         * 합성 프레임률.
         *
         * <p>강의 화면(슬라이드·코드·말하는 사람)에 30fps는 낭비다. 15로 낮추면 Egress의 인코딩
         * 부하가 절반이 되고, <b>같은 비트레이트가 프레임당 두 배로 쓰여 정지 화면의 글자가 오히려
         * 또렷해진다.</b> 화질과 서버 부하가 동시에 좋아지는 드문 조정이라 기본값으로 둔다.
         *
         * <p>움직임이 많은 콘텐츠(실물 시연 등)로 성격이 바뀌면 30으로 올린다.
         */
        int framerate,

        /** 합성 비디오 비트레이트(kbps). LiveKit H264_1080P_30 프리셋과 같은 값이 기본이다. */
        int videoBitrateKbps,

        /** 합성 오디오 비트레이트(kbps)와 샘플레이트(Hz). 프리셋 기본값과 동일하게 맞춘다. */
        int audioBitrateKbps,
        int audioFrequency
) {
    private static final int DEFAULT_WIDTH = 1920;
    private static final int DEFAULT_HEIGHT = 1080;
    private static final int DEFAULT_FRAMERATE = 15;
    private static final int DEFAULT_VIDEO_BITRATE_KBPS = 4500;
    private static final int DEFAULT_AUDIO_BITRATE_KBPS = 128;
    private static final int DEFAULT_AUDIO_FREQUENCY = 44_100;

    public EgressProperties {
        // 비우면 내부 주소를 그대로 쓴다 — 단일 호스트 개발 환경은 둘이 같다.
        if (uploadEndpoint == null || uploadEndpoint.isBlank()) {
            uploadEndpoint = s3Endpoint;
        }
        // 인코딩 옵션은 프리셋이 아니라 값으로 넘긴다. 프로토버프 기본값 0이 그대로 나가면
        // "기본값"이 아니라 "0 fps / 0 kbps"로 해석돼 녹화가 깨지므로 여기서 반드시 채운다.
        if (encodingWidth <= 0) encodingWidth = DEFAULT_WIDTH;
        if (encodingHeight <= 0) encodingHeight = DEFAULT_HEIGHT;
        if (framerate <= 0) framerate = DEFAULT_FRAMERATE;
        if (videoBitrateKbps <= 0) videoBitrateKbps = DEFAULT_VIDEO_BITRATE_KBPS;
        if (audioBitrateKbps <= 0) audioBitrateKbps = DEFAULT_AUDIO_BITRATE_KBPS;
        if (audioFrequency <= 0) audioFrequency = DEFAULT_AUDIO_FREQUENCY;
    }
}
