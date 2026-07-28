package com.liveclass.live.service;

import java.util.List;

/**
 * 실제 LiveKit 서버 방 제어 포트. 방 준비·강퇴·방닫기·참여자/트랙 조회처럼 서버에 명령하는 동작.
 * 인터페이스로 분리해 테스트에서는 목(mock)하고, 실연동은 실제 크리덴셜로 수동 검증한다.
 */
public interface LiveRoomControl {

    /**
     * 방을 준비한다(멱등). 이미 있으면 그대로 쓰고 없으면 만든다(ADR-0002 §1 preflight).
     * LiveKit {@code CreateRoom}은 같은 이름의 방이 이미 있으면 기존 방을 그대로 돌려주므로
     * 재호출해도 참가자가 끊기지 않는다.
     *
     * @return LiveKit이 발급한 {@code roomSid}
     */
    String ensureRoom(String room);

    /** 참여자를 방에서 강제로 내보낸다. */
    void removeParticipant(String room, String identity);

    /** 방을 닫는다(전원 퇴장). 방이 없으면 조용히 넘어간다. */
    void closeRoom(String room);

    /** 방의 현재 참여자 목록. 방이 없으면 빈 목록. */
    List<RoomParticipant> listParticipants(String room);

    /**
     * 방 참여자들의 마이크 publish 상태. preflight readiness 검사(ADR-0002 §1)와 LIVE 직전
     * Gate S3①(§7)이 <b>공유하는 유일한 저수준 조회</b>다 — 두 곳에서 같은 판정을 하려면
     * 같은 원천을 봐야 한다. 방이 없으면 빈 목록.
     */
    List<ParticipantMediaState> listParticipantMediaStates(String room);

    /** 참여자 요약(경계 DTO). */
    record RoomParticipant(String identity, String name, String state, long joinedAtEpochSeconds) {
    }

    /**
     * 참여자의 마이크 트랙 상태(경계 DTO).
     *
     * @param identity             참가자 identity(세션·사용자 결정론적 불투명 값)
     * @param state                LiveKit participant 상태(JOINED/ACTIVE 등)
     * @param microphonePublished  {@code source=MICROPHONE} 트랙을 publish 중인가
     * @param microphoneMuted      그 마이크 트랙이 muted인가(publish 중일 때만 의미 있음)
     */
    record ParticipantMediaState(String identity, String state,
                                 boolean microphonePublished, boolean microphoneMuted,
                                 int microphoneTrackCount) {

        /** 기존 테스트·어댑터가 단일 마이크 상태를 간단히 만들 수 있는 축약 생성자. */
        public ParticipantMediaState(String identity, String state,
                                     boolean microphonePublished, boolean microphoneMuted) {
            this(identity, state, microphonePublished, microphoneMuted,
                    microphonePublished ? 1 : 0);
        }

        /** 실제 소리가 나갈 수 있는 상태 — publish 중이고 mute가 아니다. */
        public boolean microphoneLive() {
            return microphoneTrackCount == 1 && microphonePublished && !microphoneMuted;
        }
    }
}
