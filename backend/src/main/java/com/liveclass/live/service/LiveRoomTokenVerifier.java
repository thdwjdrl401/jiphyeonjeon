package com.liveclass.live.service;

import com.auth0.jwt.JWT;
import com.auth0.jwt.algorithms.Algorithm;
import com.auth0.jwt.exceptions.JWTVerificationException;
import com.auth0.jwt.interfaces.DecodedJWT;
import com.liveclass.live.api.LiveKitServerAccess;
import org.springframework.stereotype.Component;

import java.util.Map;
import java.util.UUID;

/**
 * LiveKit 액세스 토큰으로 <b>그 방의 참가자임</b>을 확인한다(ADR-0055).
 *
 * <p><b>왜 필요한가.</b> Egress는 헤드리스 Chrome이고 `?url=&token=`으로만 열린다 — 세션 쿠키가
 * 없어 우리 API를 부를 수 없다. 그런데 판서 전체 상태를 데이터 채널로 밀면 64KB 한도에 걸리므로
 * (실측 74.9KB) Egress가 스스로 가져가야 한다.
 *
 * <p><b>왜 이 방식인가.</b> 그 토큰은 우리 {@code LIVEKIT_API_SECRET}으로 서명된 JWT이고 방 이름이
 * 들어 있다. 서명을 검증하고 방 이름이 경로의 세션과 같은지 보면 "이 방에 입장이 허가된 주체"임이
 * 증명된다 — 새 시크릿도, 새 발급 경로도 만들지 않는다. 백엔드는 이미 같은 방식으로 LiveKit
 * webhook JWT를 검증하고 있다.
 *
 * <p><b>읽기 전용이다.</b> 이것으로 판서를 쓸 수는 없다. 쓰기는 여전히 소유 강사의 세션을 요구한다
 * (§3-6d) — 방에 들어올 수 있다는 것과 문서를 고칠 수 있다는 것은 다르다.
 */
@Component
public class LiveRoomTokenVerifier {

    private final LiveKitServerAccess livekit;

    public LiveRoomTokenVerifier(LiveKitServerAccess livekit) {
        this.livekit = livekit;
    }

    /**
     * `Authorization: Bearer <livekit-token>`이 이 세션의 방에 대한 것인지 확인한다.
     *
     * @throws LiveSessionForbiddenException 서명이 틀렸거나 다른 방의 토큰일 때
     */
    public void requireRoomParticipant(UUID sessionId, String authorizationHeader) {
        String token = bearer(authorizationHeader);
        if (token == null) {
            throw new LiveSessionForbiddenException("이 라이브에 접근 권한이 없습니다.");
        }

        DecodedJWT jwt;
        try {
            jwt = JWT.require(Algorithm.HMAC256(livekit.apiSecret())).build().verify(token);
        } catch (JWTVerificationException e) {
            // 왜 거부됐는지 밖으로 흘리지 않는다 — 서명 실패와 방 불일치를 구분해 주면 탐색에 쓰인다.
            throw new LiveSessionForbiddenException("이 라이브에 접근 권한이 없습니다.");
        }

        if (!LiveSessionService.roomName(sessionId).equals(roomOf(jwt))) {
            throw new LiveSessionForbiddenException("이 라이브에 접근 권한이 없습니다.");
        }
    }

    /**
     * LiveKit은 방 이름을 {@code video.room} 클레임에 넣는다. 표준 JWT 클레임이 아니라 중첩
     * 오브젝트라 직접 꺼낸다.
     */
    private static String roomOf(DecodedJWT jwt) {
        Map<String, Object> video = jwt.getClaim("video").asMap();
        if (video == null) {
            return null;
        }
        Object room = video.get("room");
        return room instanceof String name ? name : null;
    }

    private static String bearer(String header) {
        if (header == null || !header.regionMatches(true, 0, "Bearer ", 0, 7)) {
            return null;
        }
        String value = header.substring(7).trim();
        return value.isEmpty() ? null : value;
    }
}
