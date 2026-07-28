package com.liveclass.live.service;

import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * LiveKit 참가자 identity 규약. 원시 userId를 미디어 계층에 흘리지 않도록 (session, user)에서
 * 결정론적 불투명 값을 만든다 — 방 안의 참가자끼리 서로의 identity를 보기 때문이다.
 *
 * <p>토큰 발급(입장)과 서버측 readiness 검사(preflight·Gate S3①)가 <b>같은 규칙</b>을 써야 서버가
 * 강사의 participant를 찾을 수 있으므로 한곳에 둔다.
 */
public final class LiveParticipantIdentity {

    private LiveParticipantIdentity() {
    }

    public static String of(UUID sessionId, UUID userId) {
        return UUID.nameUUIDFromBytes((sessionId + ":" + userId).getBytes(StandardCharsets.UTF_8)).toString();
    }
}
