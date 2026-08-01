package com.liveclass.live.service;

import com.liveclass.live.api.LiveKitServerAccess;
import com.liveclass.live.config.LiveKitProperties;
import io.livekit.server.RoomServiceClient;
import livekit.LivekitModels;
import okhttp3.OkHttpClient;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import retrofit2.Response;

import java.util.List;

/**
 * LiveRoomControl 구현 — LiveKit 서버의 RoomService(HTTP/TwirP)를 호출한다.
 * 서버 API URL·서명 키는 LiveKitServerAccess(설정에서 조립)로 주입받는다.
 */
@Service
public class LiveKitRoomControl implements LiveRoomControl {

    private final RoomServiceClient client;
    private final int emptyTimeoutSeconds;
    private final int departureTimeoutSeconds;

    // 생성자가 둘이라 Spring이 쓸 것을 명시한다. 없으면 테스트용 생성자를 고르려다 int 인자를
    // 채우지 못해 "No default constructor found"로 컨텍스트가 통째로 실패한다.
    @Autowired
    public LiveKitRoomControl(LiveKitServerAccess access, LiveKitProperties properties) {
        this(RoomServiceClient.createClient(
                        access.apiUrl(),
                        access.apiKey(),
                        access.apiSecret(),
                        () -> new OkHttpClient.Builder()
                                .callTimeout(access.controlTimeout())
                                .build()),
                properties.roomEmptyTimeoutSeconds(),
                properties.roomDepartureTimeoutSeconds());
    }

    /**
     * 클라이언트를 직접 받는다. 방 타임아웃 인자가 <b>올바른 자리</b>에 들어가는지 테스트로 고정하기
     * 위해서다 — `createRoom`은 같은 타입 인자가 여러 개 나열돼 있어(Integer 4개) 위치가 밀려도
     * 컴파일이 통과하고, 밀리면 강사 끊김 때 방이 20초에 닫히는 것으로만 드러난다.
     */
    LiveKitRoomControl(RoomServiceClient client, int emptyTimeoutSeconds, int departureTimeoutSeconds) {
        this.client = client;
        this.emptyTimeoutSeconds = emptyTimeoutSeconds;
        this.departureTimeoutSeconds = departureTimeoutSeconds;
    }

    /**
     * LiveKit {@code CreateRoom}은 같은 이름의 방이 이미 있으면 오류 대신 <b>기존 방</b>을 돌려준다.
     * 그래서 별도 존재 확인 없이 호출 한 번으로 멱등하게 준비된다.
     *
     * <p><b>타임아웃을 명시한다.</b> 비워 두면 LiveKit 기본값 `departure_timeout=20`이 적용되는데,
     * 강사가 20초 안에 돌아오지 못하면 방이 닫히고 Egress가 종료되어 HLS·녹화가 영구히 끊긴다.
     * 인자 순서에 주의: `departureTimeout`은 <b>마지막</b> 파라미터다
     * ({@code createRoom(name, emptyTimeout, maxParticipants, nodeId, metadata,
     * minPlayoutDelay, maxPlayoutDelay, syncStreams, departureTimeout)}).
     */
    @Override
    public String ensureRoom(String room) {
        Response<LivekitModels.Room> response = execute("createRoom", client.createRoom(
                room, emptyTimeoutSeconds, null, null, null, null, null, null, departureTimeoutSeconds));
        LivekitModels.Room body = response.body();
        if (body == null) {
            throw new LiveRoomControlException("LiveKit createRoom 응답이 비어 있습니다: " + room, null);
        }
        return body.getSid();
    }

    @Override
    public void removeParticipant(String room, String identity) {
        call("removeParticipant", client.removeParticipant(room, identity));
    }

    @Override
    public void closeRoom(String room) {
        call("deleteRoom", client.deleteRoom(room));
    }

    @Override
    public List<RoomParticipant> listParticipants(String room) {
        return participants(room).stream()
                .map(p -> new RoomParticipant(p.getIdentity(), p.getName(), p.getState().name(), p.getJoinedAt()))
                .toList();
    }

    @Override
    public List<ParticipantMediaState> listParticipantMediaStates(String room) {
        return participants(room).stream()
                .map(LiveKitParticipantMedia::of)
                .toList();
    }

    private List<LivekitModels.ParticipantInfo> participants(String room) {
        Response<List<LivekitModels.ParticipantInfo>> response =
                execute("listParticipants", client.listParticipants(room));
        List<LivekitModels.ParticipantInfo> body = response.body();
        return body == null ? List.of() : body;
    }

    private void call(String op, retrofit2.Call<?> retrofitCall) {
        execute(op, retrofitCall);
    }

    private <T> Response<T> execute(String op, retrofit2.Call<T> retrofitCall) {
        try {
            Response<T> response = retrofitCall.execute();
            // 404 = 대상(참여자·방)이 이미 없음 → 목표가 이미 달성된 것이라 멱등하게 성공으로 본다.
            // 그 외 비2xx만 상위 서비스 오류로 처리한다.
            if (!response.isSuccessful() && response.code() != 404) {
                throw new LiveRoomControlException("LiveKit " + op + " 실패: HTTP " + response.code(), null);
            }
            return response;
        } catch (java.io.IOException e) {
            throw new LiveRoomControlException("LiveKit " + op + " 호출 오류", e);
        }
    }

    /** participant 프로토버프의 {@code tracks}에서 마이크 트랙만 뽑아 경계 DTO로 접는다. */
    private static final class LiveKitParticipantMedia {

        private LiveKitParticipantMedia() {
        }

        static ParticipantMediaState of(LivekitModels.ParticipantInfo p) {
            List<LivekitModels.TrackInfo> microphones = p.getTracksList().stream()
                    .filter(t -> t.getSource() == LivekitModels.TrackSource.MICROPHONE)
                    .toList();
            LivekitModels.TrackInfo microphone = microphones.size() == 1 ? microphones.get(0) : null;
            return new ParticipantMediaState(
                    p.getIdentity(),
                    p.getState().name(),
                    !microphones.isEmpty(),
                    microphone != null && microphone.getMuted(),
                    microphones.size());
        }
    }
}
