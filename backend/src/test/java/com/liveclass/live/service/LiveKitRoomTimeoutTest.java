package com.liveclass.live.service;

import io.livekit.server.RoomServiceClient;
import livekit.LivekitModels;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import retrofit2.Call;
import retrofit2.Response;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * 방 타임아웃을 <b>명시</b>해서 만드는지 고정한다.
 *
 * <p>비워 두면 LiveKit 기본값 {@code departure_timeout=20}이 적용된다. 강사가 20초 안에 돌아오지
 * 못하면 방이 닫히고, 방이 닫히면 Egress가 종료되어 <b>HLS와 녹화가 영구히 끊긴다</b> — 강사가 다시
 * 접속해도 그 방송은 되살아나지 않는다. 와이파이 전환처럼 수십 초 끊기는 일이 흔해 기본값으로는
 * 강의를 진행할 수 없다.
 *
 * <p>특히 <b>인자 위치</b>를 확인한다. {@code createRoom}은 Integer 인자가 네 개 나열돼 있어
 * ({@code emptyTimeout, maxParticipants, minPlayoutDelay, maxPlayoutDelay, departureTimeout})
 * 자리가 밀려도 컴파일이 통과한다. 밀리면 "강사가 잠깐 끊기면 방송이 죽는다"는 증상으로만 드러나서
 * 눈으로 잡기 어렵다.
 */
class LiveKitRoomTimeoutTest {

    private static final int EMPTY_TIMEOUT = 900;
    private static final int DEPARTURE_TIMEOUT = 600;

    @Test
    void createRoom에_empty와_departure_타임아웃을_각자_자리에_넣는다() throws Exception {
        RoomServiceClient client = mock(RoomServiceClient.class);
        @SuppressWarnings("unchecked")
        Call<LivekitModels.Room> call = mock(Call.class);
        when(call.execute()).thenReturn(
                Response.success(LivekitModels.Room.newBuilder().setSid("RM_test").build()));
        when(client.createRoom(any(), any(), any(), any(), any(), any(), any(), any(), any()))
                .thenReturn(call);

        LiveKitRoomControl control = new LiveKitRoomControl(client, EMPTY_TIMEOUT, DEPARTURE_TIMEOUT);
        String sid = control.ensureRoom("session-abc");

        assertThat(sid).isEqualTo("RM_test");

        ArgumentCaptor<String> name = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<Integer> emptyTimeout = ArgumentCaptor.forClass(Integer.class);
        ArgumentCaptor<Integer> maxParticipants = ArgumentCaptor.forClass(Integer.class);
        ArgumentCaptor<Integer> departureTimeout = ArgumentCaptor.forClass(Integer.class);
        verify(client).createRoom(
                name.capture(),
                emptyTimeout.capture(),
                maxParticipants.capture(),
                any(), any(), any(), any(), any(),
                departureTimeout.capture());

        assertThat(name.getValue()).isEqualTo("session-abc");
        assertThat(emptyTimeout.getValue()).isEqualTo(EMPTY_TIMEOUT);
        assertThat(departureTimeout.getValue()).isEqualTo(DEPARTURE_TIMEOUT);
        // 참가자 수는 제한하지 않는다 — 여기에 타임아웃이 잘못 들어가면 수강생 입장이 막힌다.
        assertThat(maxParticipants.getValue()).isNull();
    }
}
