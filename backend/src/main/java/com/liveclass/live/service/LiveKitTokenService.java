package com.liveclass.live.service;

import com.liveclass.live.config.LiveKitProperties;
import io.livekit.server.AccessToken;
import io.livekit.server.CanPublish;
import io.livekit.server.CanPublishData;
import io.livekit.server.CanSubscribe;
import io.livekit.server.CanUpdateOwnMetadata;
import io.livekit.server.RoomJoin;
import io.livekit.server.RoomName;
import org.springframework.stereotype.Service;

import java.time.Instant;
import java.util.Date;

/**
 * LiveKit 입장 토큰(JWT) 발급. apiSecret으로 서명하며 방·역할·만료를 담는다.
 * 실제 LiveKit 서버 없이도 서명·구조를 검증할 수 있다(단위 테스트 용이).
 */
@Service
public class LiveKitTokenService {

    private final LiveKitProperties properties;

    public LiveKitTokenService(LiveKitProperties properties) {
        this.properties = properties;
    }

    /** 방 입장 토큰을 발급한다. publisher=true면 송출·구독 모두, false면 구독 전용. */
    public IssuedToken issue(String roomName, String identity, String displayName, boolean publisher) {
        Instant expiresAt = Instant.now().plusSeconds(properties.tokenTtlSeconds());

        AccessToken token = new AccessToken(properties.apiKey(), properties.apiSecret());
        token.setIdentity(identity);
        if (displayName != null) {
            token.setName(displayName);
        }
        token.setExpiration(Date.from(expiresAt));
        token.addGrants(
                new RoomJoin(true),
                new RoomName(roomName),
                new CanSubscribe(true),
                new CanPublish(publisher),
                new CanPublishData(publisher),
                // 강사가 합성 화면의 카메라 배치를 자기 participant metadata에 쓴다. Egress 템플릿이
                // 그 값을 읽어 같은 자리에 그리므로, 강사가 보는 화면과 수강생이 보는 녹화가 일치한다.
                // 남의 metadata는 못 건드리고(Own) 수강생 토큰에는 주지 않는다.
                new CanUpdateOwnMetadata(publisher));

        return new IssuedToken(token.toJwt(), expiresAt, publisher);
    }

    public String url() {
        return properties.url();
    }

    /** 발급 결과. jwt는 서명된 토큰, expiresAt는 만료 시각. */
    public record IssuedToken(String jwt, Instant expiresAt, boolean publisher) {
    }
}
