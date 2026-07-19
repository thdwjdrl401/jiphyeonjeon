package com.liveclass.live.service;

import java.util.List;

/**
 * 실제 LiveKit 서버 방 제어 포트. 강퇴·방닫기·참여자 조회처럼 서버에 명령하는 동작.
 * 인터페이스로 분리해 테스트에서는 목(mock)하고, 실연동은 실제 크리덴셜로 수동 검증한다.
 */
public interface LiveRoomControl {

    /** 참여자를 방에서 강제로 내보낸다. */
    void removeParticipant(String room, String identity);

    /** 방을 닫는다(전원 퇴장). 방이 없으면 조용히 넘어간다. */
    void closeRoom(String room);

    /** 방의 현재 참여자 목록. 방이 없으면 빈 목록. */
    List<RoomParticipant> listParticipants(String room);

    /** 참여자 요약(경계 DTO). */
    record RoomParticipant(String identity, String name, String state, long joinedAtEpochSeconds) {
    }
}
