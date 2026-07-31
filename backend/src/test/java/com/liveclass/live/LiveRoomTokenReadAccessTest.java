package com.liveclass.live;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.liveclass.live.api.LiveKitServerAccess;
import com.liveclass.live.service.LiveRoomTokenVerifier;
import com.liveclass.live.service.LiveSessionForbiddenException;
import org.junit.jupiter.api.Test;

import java.util.Date;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Egress가 판서 문서를 <b>읽을</b> 자격(ADR-0055).
 *
 * <p>Egress는 헤드리스 Chrome이라 세션 쿠키가 없고 LiveKit 토큰만 갖고 있다. 그런데 판서 전체를
 * 데이터 채널로 밀면 64KB 한도에 걸리므로(실측 74.9KB) 스스로 가져가야 한다. 그 토큰은 우리
 * 시크릿으로 서명됐고 방 이름을 담고 있으니, 그것으로 "이 방의 참가자"임을 확인한다.
 *
 * <p>여기서 고정하는 것은 <b>그 자격이 어디까지인가</b>다 — 방에 들어올 수 있다는 것과 문서를
 * 고칠 수 있다는 것은 다르다.
 */
class LiveRoomTokenReadAccessTest {

    private static final String SECRET = "test-secret-test-secret-test-secret";
    private static final UUID SESSION = UUID.fromString("11111111-1111-1111-1111-111111111111");

    private static final LiveKitServerAccess ACCESS =
            new LiveKitServerAccess("http://localhost:7880", "devkey", SECRET);

    private final LiveRoomTokenVerifier verifier = new LiveRoomTokenVerifier(ACCESS);

    /** LiveKit이 실제로 내는 형태 — 방 이름은 중첩된 {@code video.room}에 들어간다. */
    private static String tokenFor(String room, String secret) {
        return JWT.create()
                .withIssuer("devkey")
                .withSubject("egress")
                .withExpiresAt(new Date(System.currentTimeMillis() + 600_000))
                .withClaim("video", Map.of("room", room, "roomJoin", true))
                .sign(Algorithm.HMAC256(secret));
    }

    @Test
    void 그_방의_토큰이면_읽게_한다() {
        String token = tokenFor("session-" + SESSION, SECRET);

        assertThatCode(() -> verifier.requireRoomParticipant(SESSION, "Bearer " + token))
                .doesNotThrowAnyException();
    }

    /**
     * 다른 강의의 토큰으로 남의 판서를 읽을 수 있으면 안 된다. 서명만 맞으면 통과시키는 구현에서
     * 나오는 전형적인 구멍이다.
     */
    @Test
    void 다른_방의_토큰은_거부한다() {
        String token = tokenFor("session-" + UUID.randomUUID(), SECRET);

        assertThatThrownBy(() -> verifier.requireRoomParticipant(SESSION, "Bearer " + token))
                .isInstanceOf(LiveSessionForbiddenException.class);
    }

    /** 우리 시크릿으로 서명되지 않았다면 우리가 발급한 토큰이 아니다. */
    @Test
    void 다른_시크릿으로_서명된_토큰은_거부한다() {
        String token = tokenFor("session-" + SESSION, "someone-elses-secret-someone-elses");

        assertThatThrownBy(() -> verifier.requireRoomParticipant(SESSION, "Bearer " + token))
                .isInstanceOf(LiveSessionForbiddenException.class);
    }

    @Test
    void 만료된_토큰은_거부한다() {
        String token = JWT.create()
                .withExpiresAt(new Date(System.currentTimeMillis() - 1000))
                .withClaim("video", Map.of("room", "session-" + SESSION))
                .sign(Algorithm.HMAC256(SECRET));

        assertThatThrownBy(() -> verifier.requireRoomParticipant(SESSION, "Bearer " + token))
                .isInstanceOf(LiveSessionForbiddenException.class);
    }

    /** 방 클레임이 없는 토큰(예: webhook용)으로는 판서를 읽을 수 없다. */
    @Test
    void 방_클레임이_없으면_거부한다() {
        String token = JWT.create()
                .withExpiresAt(new Date(System.currentTimeMillis() + 600_000))
                .withClaim("sha256", "whatever")
                .sign(Algorithm.HMAC256(SECRET));

        assertThatThrownBy(() -> verifier.requireRoomParticipant(SESSION, "Bearer " + token))
                .isInstanceOf(LiveSessionForbiddenException.class);
    }

    @Test
    void 헤더가_없거나_형식이_아니면_거부한다() {
        for (String header : new String[]{null, "", "   ", "Bearer", "Bearer ", "Basic abc"}) {
            assertThatThrownBy(() -> verifier.requireRoomParticipant(SESSION, header))
                    .as("header=%s", header)
                    .isInstanceOf(LiveSessionForbiddenException.class);
        }
    }

    /**
     * 거부 사유를 밖으로 흘리지 않는다. 서명 실패와 방 불일치를 구분해 주면 탐색에 쓰인다 —
     * "이 방은 존재한다"는 사실 자체가 정보다.
     */
    @Test
    void 거부_사유를_구분해_알려주지_않는다() {
        String wrongRoom = tokenFor("session-" + UUID.randomUUID(), SECRET);
        String wrongSecret = tokenFor("session-" + SESSION, "someone-elses-secret-someone-elses");

        String a = messageOf(wrongRoom);
        String b = messageOf(wrongSecret);

        assertThatCode(() -> {
            if (!a.equals(b)) {
                throw new AssertionError("거부 메시지가 갈린다: " + a + " vs " + b);
            }
        }).doesNotThrowAnyException();
    }

    private String messageOf(String token) {
        try {
            verifier.requireRoomParticipant(SESSION, "Bearer " + token);
            return "(통과)";
        } catch (LiveSessionForbiddenException e) {
            return e.getMessage();
        }
    }
}
