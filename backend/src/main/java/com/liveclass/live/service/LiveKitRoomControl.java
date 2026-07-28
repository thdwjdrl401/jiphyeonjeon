package com.liveclass.live.service;

import com.liveclass.live.api.LiveKitServerAccess;
import io.livekit.server.RoomServiceClient;
import livekit.LivekitModels;
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

    public LiveKitRoomControl(LiveKitServerAccess access) {
        this.client = RoomServiceClient.create(access.apiUrl(), access.apiKey(), access.apiSecret(), false, null);
    }

    /**
     * LiveKit {@code CreateRoom}은 같은 이름의 방이 이미 있으면 오류 대신 <b>기존 방</b>을 돌려준다.
     * 그래서 별도 존재 확인 없이 호출 한 번으로 멱등하게 준비된다.
     */
    @Override
    public String ensureRoom(String room) {
        Response<LivekitModels.Room> response =
                execute("createRoom", client.createRoom(room, null, null, null, null, null, null, null, null));
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
