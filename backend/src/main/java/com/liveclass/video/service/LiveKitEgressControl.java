package com.liveclass.video.service;

import com.liveclass.live.api.LiveKitServerAccess;
import com.liveclass.video.config.EgressProperties;
import io.livekit.server.AudioMixing;
import io.livekit.server.EgressServiceClient;
import livekit.LivekitEgress;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import retrofit2.Response;

import java.io.IOException;

/**
 * LiveKit Egress 실제 제어. 방 컴포지트를 HLS(세그먼트)로 녹화해 S3/MinIO에 올린다(ADR-0010).
 * LiveKit 서버 API 접속 정보는 live 모듈 포트({@link LiveKitServerAccess})로 받고, 출력 S3 설정은 {@link EgressProperties}.
 *
 * <p><b>주의</b>: 이 경로는 아직 실제 Egress 인프라(egress 컨테이너·MinIO·발행 참가자)로 검증되지 않았다.
 * 토큰/강퇴처럼 실환경 e2e 확인은 후속(songjeongki/0020 참고). 상태기계·배선은 목으로 검증한다.
 */
@Component
public class LiveKitEgressControl implements EgressControl {

    private static final Logger log = LoggerFactory.getLogger(LiveKitEgressControl.class);

    private final EgressServiceClient client;
    private final EgressProperties egress;

    public LiveKitEgressControl(LiveKitServerAccess livekit, EgressProperties egress) {
        this.client = EgressServiceClient.Companion.create(livekit.apiUrl(), livekit.apiKey(), livekit.apiSecret());
        this.egress = egress;
    }

    @Override
    public String startHlsRecording(String roomName, String objectPrefix) {
        LivekitEgress.S3Upload s3 = LivekitEgress.S3Upload.newBuilder()
                .setAccessKey(egress.s3AccessKey())
                .setSecret(egress.s3Secret())
                .setBucket(egress.bucket())
                // Egress는 호스트 네트워크로 돌아 도커 서비스명(minio)을 해석하지 못한다.
                // 백엔드의 읽기 주소가 아니라 업로드 전용 주소를 넘긴다(EgressProperties javadoc).
                .setEndpoint(egress.uploadEndpoint())
                .setRegion(egress.s3Region())
                .setForcePathStyle(egress.forcePathStyle())
                .build();
        LivekitEgress.SegmentedFileOutput output = LivekitEgress.SegmentedFileOutput.newBuilder()
                .setFilenamePrefix(objectPrefix + "/seg")
                .setPlaylistName(egress.playlistName())
                .setLivePlaylistName(egress.livePlaylistName())
                .setSegmentDuration(egress.segmentDurationSeconds())
                .setS3(s3)
                .build();
        try {
            // preset·options는 null 허용(기본 인코딩), audioMixing은 non-null 필수(실 검증에서 확인).
            Response<LivekitEgress.EgressInfo> res = client.startRoomCompositeEgress(
                    roomName, output, egress.layout(), null, null, false, false, "", AudioMixing.DEFAULT_MIXING).execute();
            if (!res.isSuccessful() || res.body() == null) {
                throw new EgressControlException("Egress 시작 실패: HTTP " + res.code());
            }
            String egressId = res.body().getEgressId();
            log.info("Egress 녹화 시작 room={} egressId={}", roomName, egressId);
            return egressId;
        } catch (IOException e) {
            throw new EgressControlException("Egress 시작 통신 실패: " + roomName, e);
        }
    }

    @Override
    public void stopRecording(String egressId) {
        try {
            Response<LivekitEgress.EgressInfo> res = client.stopEgress(egressId).execute();
            // 이미 없는/끝난 egress(중복 중지 등)는 성공으로 간주해 멱등하게 둔다.
            if (!res.isSuccessful() && res.code() != 404) {
                throw new EgressControlException("Egress 중지 실패: HTTP " + res.code());
            }
            log.info("Egress 녹화 중지 egressId={}", egressId);
        } catch (IOException e) {
            throw new EgressControlException("Egress 중지 통신 실패: " + egressId, e);
        }
    }
}
