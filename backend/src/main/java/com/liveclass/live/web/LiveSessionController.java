package com.liveclass.live.web;

import com.liveclass.live.api.LiveSessionManagement;
import com.liveclass.live.api.LiveSessionView;
import com.liveclass.live.service.LiveKitTokenService;
import com.liveclass.live.service.LiveSessionNotFoundException;
import com.liveclass.live.web.dto.LiveTokenResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 라이브 세션 조회·토큰·시작/종료(live 모듈). 생성은 소유권 때문에 curriculum이 오케스트레이션한다.
 * 시작/종료는 후속.
 */
@Tag(name = "라이브 세션", description = "라이브 세션 생성(강사)·조회·토큰·시작/종료.")
@RestController
public class LiveSessionController {

    private final LiveSessionManagement liveSessionManagement;
    private final LiveKitTokenService tokenService;

    public LiveSessionController(LiveSessionManagement liveSessionManagement, LiveKitTokenService tokenService) {
        this.liveSessionManagement = liveSessionManagement;
        this.tokenService = tokenService;
    }

    @Operation(summary = "라이브 세션 조회", description = "라이브 세션의 기본 정보를 조회한다.")
    @GetMapping("/api/live-sessions/{sessionId}")
    public LiveSessionView get(@PathVariable UUID sessionId) {
        return liveSessionManagement.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
    }

    /**
     * 방 입장 토큰 발급. 요청자가 세션 강사면 publisher(송출+구독), 아니면 subscriber(구독 전용).
     * 세밀한 입장 게이팅(수강생만 등)·세션 LIVE 상태 검사는 수강/시작 기능과 함께 후속.
     */
    @Operation(summary = "LiveKit 토큰 발급", description = "라이브 방에 접속할 입장 토큰을 발급한다. 세션을 만든 강사는 화면·음성을 내보낼 수 있고(송출), 그 외 참여자는 시청만 할 수 있다.")
    @PostMapping("/api/live-sessions/{sessionId}/token")
    public LiveTokenResponse token(@PathVariable UUID sessionId, Authentication authentication) {
        LiveSessionView session = liveSessionManagement.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));

        String requesterId = authentication.getName();
        boolean publisher = requesterId.equals(session.instructorId().toString());
        // 방 이름은 세션 ID로 결정론적으로 만든다. LiveKit이 붙이는 room_sid는 실제 시작 시 채운다.
        String room = "session-" + sessionId;

        // displayName(참여자 표시명·수강생 익명화)은 화면 요구가 붙을 때 채운다 — 지금은 식별자만.
        var issued = tokenService.issue(room, requesterId, null, publisher);

        return new LiveTokenResponse(
                "LIVEKIT",
                tokenService.url(),
                issued.jwt(),
                issued.expiresAt(),
                new LiveTokenResponse.Participant(requesterId, null),
                new LiveTokenResponse.Grants(true, publisher, publisher));
    }
}
