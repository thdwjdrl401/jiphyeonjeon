package com.liveclass.video.service;

import java.util.UUID;

/** live 모듈 내부 helper에 역의존하지 않고 같은 공개 room 명명 규약을 사용하는 video 로컬 값 객체. */
final class LiveSessionRoomNames {

    private LiveSessionRoomNames() {
    }

    static String of(UUID sessionId) {
        return "session-" + sessionId;
    }
}
