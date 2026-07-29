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
import java.util.List;
import java.util.Optional;

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
            // preset을 안 주면 Egress 기본값 720p로 합성한다. 강사가 1080p 화면공유를 올려도 720p로
            // 다운스케일돼 코드·슬라이드 글자가 뭉갠다(EC2 실측). options는 null 허용, audioMixing은 non-null 필수.
            Response<LivekitEgress.EgressInfo> res = client.startRoomCompositeEgress(
                    roomName, output, egress.layout(), encodingPreset(), null, false, false, "",
                    AudioMixing.DEFAULT_MIXING).execute();
            if (!res.isSuccessful() || res.body() == null) {
                throw new EgressControlException("Egress 시작 실패: HTTP " + res.code());
            }
            String egressId = res.body().getEgressId();
            log.info("Egress 녹화 시작 room={} egressId={}", roomName, egressId);
            return egressId;
        } catch (IOException e) {
            throw new EgressStartOutcomeUnknownException("Egress 시작 응답 확인 실패: " + roomName, e);
        }
    }

    /**
     * {@code EgressServiceClient.listEgress(roomName, egressId, active)}로 단건 조회한다 — SDK에는 단건
     * {@code getEgress}가 없고 list의 {@code egressId} 필터가 그 역할을 한다.
     */
    @Override
    public Optional<EgressState> findState(String egressId) {
        try {
            Response<List<LivekitEgress.EgressInfo>> res = client.listEgress(null, egressId, null).execute();
            if (!res.isSuccessful() || res.body() == null) {
                throw new EgressControlException("Egress 상태 조회 실패: HTTP " + res.code());
            }
            return res.body().stream()
                    .filter(info -> egressId.equals(info.getEgressId()))
                    .findFirst()
                    .map(info -> toState(info.getStatus()));
        } catch (IOException e) {
            throw new EgressControlException("Egress 상태 조회 통신 실패: " + egressId, e);
        }
    }

    @Override
    public Optional<EgressSnapshot> findActiveForRoom(String roomName) {
        try {
            Response<List<LivekitEgress.EgressInfo>> res = client.listEgress(roomName, null, true).execute();
            if (!res.isSuccessful() || res.body() == null) {
                throw new EgressControlException("방 Egress 조회 실패: HTTP " + res.code());
            }
            List<LivekitEgress.EgressInfo> active = res.body().stream()
                    .filter(info -> info.getStatus() == LivekitEgress.EgressStatus.EGRESS_STARTING
                            || info.getStatus() == LivekitEgress.EgressStatus.EGRESS_ACTIVE)
                    .toList();
            if (active.size() > 1) {
                throw new EgressControlException(
                        "같은 방에 진행 중 Egress가 둘 이상입니다: room=" + roomName + ", count=" + active.size());
            }
            return active.stream().findFirst()
                    .map(info -> new EgressSnapshot(info.getEgressId(), toState(info.getStatus())));
        } catch (IOException e) {
            throw new EgressControlException("방 Egress 상태 조회 통신 실패: " + roomName, e);
        }
    }

    /** 프로토버프 enum → 경계 enum. 우리가 모르는 값(UNRECOGNIZED 등)은 UNKNOWN으로 접어 계속 기다린다. */
    private EgressState toState(LivekitEgress.EgressStatus status) {
        try {
            return EgressState.valueOf(status.name());
        } catch (IllegalArgumentException e) {
            log.warn("모르는 Egress 상태: {}", status);
            return EgressState.UNKNOWN;
        }
    }

    /**
     * 합성 출력 인코딩 프리셋. 설정값이 열거형에 없으면 기본값으로 떨어뜨린다 —
     * 오타 하나로 녹화 자체가 죽는 것보다 낫다(녹화는 best-effort 경로다).
     */
    private LivekitEgress.EncodingOptionsPreset encodingPreset() {
        try {
            return LivekitEgress.EncodingOptionsPreset.valueOf(egress.encodingPreset());
        } catch (IllegalArgumentException | NullPointerException e) {
            log.warn("알 수 없는 Egress 프리셋 '{}' — 기본값 사용", egress.encodingPreset());
            return LivekitEgress.EncodingOptionsPreset.H264_1080P_30;
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
