package com.liveclass.video.service;

import com.liveclass.live.api.LiveKitServerAccess;
import com.liveclass.video.config.EgressProperties;
import io.livekit.server.AudioMixing;
import io.livekit.server.EgressServiceClient;
import livekit.LivekitEgress;
import livekit.LivekitModels;
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
            // 프리셋 대신 값으로 넘긴다 — 프리셋에는 30fps 고정본만 있어 프레임률을 낮출 수 없다.
            // preset과 advanced는 배타적이라 preset 자리에 null을 준다. audioMixing은 non-null 필수.
            Response<LivekitEgress.EgressInfo> res = client.startRoomCompositeEgress(
                    roomName, output, egress.layout(), null, encodingOptions(), false, false,
                    templateBaseUrl(), AudioMixing.DEFAULT_MIXING).execute();
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
     * 합성 출력 인코딩 옵션.
     *
     * <p>프리셋({@code H264_1080P_30} 등)은 30fps 고정이라 프레임률을 낮출 수 없어 값으로 넘긴다.
     * 코덱·비트레이트·샘플레이트는 기존 프리셋과 동일하게 맞추고 프레임률만 내린다 — 그래야
     * 이 변경의 효과가 프레임률 하나로 귀결되어 판단이 흐려지지 않는다.
     *
     * <p><b>모든 필드를 명시한다.</b> 프로토버프는 미설정 정수를 0으로 보내고 Egress는 그것을
     * "기본값"이 아니라 "0 fps / 0 kbps"로 받는다. 하나라도 비우면 오디오가 사라지거나 녹화가 깨진다.
     *
     * <p>키프레임 간격은 세그먼트 길이에 맞춘다. HLS 세그먼트는 키프레임에서 시작해야 하므로,
     * GOP가 세그먼트보다 길면 Egress가 경계마다 키프레임을 강제로 끼워 넣어 비트를 낭비한다.
     */
    /**
     * 합성 화면을 그릴 페이지. 빈 문자열이면 Egress가 LiveKit 기본 템플릿을 쓴다 —
     * 설정이 빠졌을 때 녹화가 죽는 대신 예전 레이아웃으로 돌아가게 둔다(녹화 > 레이아웃).
     */
    private String templateBaseUrl() {
        String configured = egress.templateBaseUrl();
        return configured == null ? "" : configured.strip();
    }

    private LivekitEgress.EncodingOptions encodingOptions() {
        return LivekitEgress.EncodingOptions.newBuilder()
                .setWidth(egress.encodingWidth())
                .setHeight(egress.encodingHeight())
                .setFramerate(egress.framerate())
                .setVideoCodec(LivekitModels.VideoCodec.H264_MAIN)
                .setVideoBitrate(egress.videoBitrateKbps())
                .setKeyFrameInterval(egress.segmentDurationSeconds())
                .setAudioCodec(LivekitModels.AudioCodec.AAC)
                .setAudioBitrate(egress.audioBitrateKbps())
                .setAudioFrequency(egress.audioFrequency())
                .build();
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
