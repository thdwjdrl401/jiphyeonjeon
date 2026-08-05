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

        /**
         * 합성 비디오 비트레이트(kbps).
         *
         * <p><b>재인코딩이 화질 상한이 되지 않도록</b> 원본보다 넉넉히 잡는다. 강사 송출은
         * 1080p30 프리셋(5,000kbps)이라 프레임당 167kbit인데, 우리는 15fps로 내보내므로
         * 8,000kbps면 프레임당 533kbit — 원본의 3배다. 이미 손실된 프레임을 더 여유 있는 예산으로
         * 다시 인코딩하는 셈이라 2차 손실이 사실상 없다.
         *
         * <p>여기서 더 올려도 화질은 안 좋아진다. <b>상한은 강사 송출이다</b> — Egress에 도착하지
         * 않은 디테일은 어떤 서버 설정으로도 복구되지 않는다(프론트 {@code publishQuality.ts}).
         *
         * <p>인코딩 부하의 대부분(움직임 예측·모드 결정)은 해상도와 프레임률이 좌우하므로 이 값을
         * 올려도 CPU는 <b>많이</b> 늘지 않는다. 다만 <b>0은 아니다</b> — 계수가 늘면 엔트로피
         * 코딩 비용이 따라 는다. 4,500kbps에서 녹화 1건이 1.85코어였는데(EC2·lazy 양쪽 실측),
         * 8,000kbps에서의 값은 아직 재지 않았다. Egress의 {@code room_composite_cpu_cost}(방 하나에
         * 예약하는 코어 수, 기본 4.0)를 낮춰 동시 녹화 방 수를 늘리려면 <b>이 값으로 다시 재고</b>
         * 정해야 한다.
         */
        int videoBitrateKbps,

        /** 합성 오디오 비트레이트(kbps)와 샘플레이트(Hz). 프리셋 기본값과 동일하게 맞춘다. */
        int audioBitrateKbps,
        int audioFrequency,

        /**
         * 합성 화면을 그릴 페이지 주소. Egress의 헤드리스 Chrome이 여기에
         * {@code ?url=&token=&layout=}을 붙여 연다.
         *
         * <p>비우면 LiveKit 기본 템플릿을 쓴다. 기본 템플릿은 화면공유와 카메라를 나란히 놓아
         * 1920 폭 화면공유가 1587로 축소되고 좌하단에 쓰지 않는 검은 영역이 남는다(운영 프레임 실측).
         * 우리 템플릿({@code /egress/stage})은 화면공유가 캔버스를 채우고 카메라를 그 위에 얹는다.
         *
         * <p><b>Egress 컨테이너에서 열리는 주소여야 한다.</b> 브라우저가 보는 주소가 아니라
         * Egress가 접근하는 주소다 — 운영은 공개 도메인, 개발은 Egress가 닿는 호스트 주소를 넣는다.
         *
         * <p>오리진만 주면 된다. 템플릿 경로는 코드가 붙인다
         * ({@code LiveKitEgressControl.templateUrl}) — 경로는 우리 프론트의 라우트라
         * 운영이 알 필요가 없고, 빠뜨리면 녹화가 통째로 실패한다.
         */
        String templateBaseUrl
) {
    private static final int DEFAULT_WIDTH = 1920;
    private static final int DEFAULT_HEIGHT = 1080;
    private static final int DEFAULT_FRAMERATE = 15;
    private static final int DEFAULT_VIDEO_BITRATE_KBPS = 8000;
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
