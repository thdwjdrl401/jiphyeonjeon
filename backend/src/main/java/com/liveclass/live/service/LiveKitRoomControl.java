package com.liveclass.live.service;

import com.liveclass.common.config.LiveKitProperties;
import io.livekit.server.RoomServiceClient;
import livekit.LivekitModels;
import org.springframework.stereotype.Service;
import retrofit2.Response;

import java.util.List;

/**
 * LiveRoomControl 구현 — LiveKit 서버의 RoomService(HTTP/TwirP)를 호출한다.
 * client URL은 접속용 wss라서 서버 API용 https로 바꿔 쓴다. 서명 키는 환경변수로 주입.
 */
@Service
public class LiveKitRoomControl implements LiveRoomControl {

    private final RoomServiceClient client;

    public LiveKitRoomControl(LiveKitProperties properties) {
        String apiUrl = properties.url()
                .replaceFirst("^wss://", "https://")
                .replaceFirst("^ws://", "http://");
        this.client = RoomServiceClient.create(apiUrl, properties.apiKey(), properties.apiSecret(), false, null);
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
        Response<List<LivekitModels.ParticipantInfo>> response = execute("listParticipants", client.listParticipants(room));
        List<LivekitModels.ParticipantInfo> body = response.body();
        if (body == null) {
            return List.of();
        }
        return body.stream()
                .map(p -> new RoomParticipant(p.getIdentity(), p.getName(), p.getState().name(), p.getJoinedAt()))
                .toList();
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
}
