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
         * 합성 출력 인코딩 프리셋({@code LivekitEgress.EncodingOptionsPreset} 이름).
         *
         * <p>안 주면 Egress 기본값이 720p라, 강사가 1080p 화면공유를 올려도 다운스케일돼
         * 코드·슬라이드 글자가 뭉갠다(EC2 실측). 반대로 카메라만 켠 세션은 소스가 720p라
         * 1080p로 올려도 업스케일일 뿐이니, 콘텐츠 성격이 바뀌면 이 값을 조정한다.
         */
        String encodingPreset
) {
    private static final String DEFAULT_ENCODING_PRESET = "H264_1080P_30";

    public EgressProperties {
        // 비우면 내부 주소를 그대로 쓴다 — 단일 호스트 개발 환경은 둘이 같다.
        if (uploadEndpoint == null || uploadEndpoint.isBlank()) {
            uploadEndpoint = s3Endpoint;
        }
        if (encodingPreset == null || encodingPreset.isBlank()) {
            encodingPreset = DEFAULT_ENCODING_PRESET;
        }
    }
}
