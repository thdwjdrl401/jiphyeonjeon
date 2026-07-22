package com.liveclass.live.web;

import com.liveclass.live.api.LiveSessionView;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.service.LiveKitTokenService;
import com.liveclass.live.service.LiveAccessGuard;
import com.liveclass.live.service.LiveSessionNotFoundException;
import com.liveclass.live.service.LiveSessionService;
import com.liveclass.live.service.LiveSessionStateConflictException;
import com.liveclass.live.web.dto.LiveTokenResponse;
import com.liveclass.live.web.dto.ParticipantView;
import com.liveclass.live.web.dto.UpdateLiveSessionRequest;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PatchMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;

/**
 * 라이브 세션 조회·토큰·시작/종료·일정수정·취소(live 모듈). 생성은 소유권 때문에 curriculum이 오케스트레이션한다.
 */
@Tag(name = "라이브 세션", description = "라이브 세션 생성(강사)·조회·토큰·시작/종료.")
@RestController
public class LiveSessionController {

    private final LiveSessionService liveSessionService;
    private final LiveKitTokenService tokenService;
    private final LiveAccessGuard accessGuard;

    public LiveSessionController(LiveSessionService liveSessionService, LiveKitTokenService tokenService,
                                LiveAccessGuard accessGuard) {
        this.liveSessionService = liveSessionService;
        this.tokenService = tokenService;
        this.accessGuard = accessGuard;
    }

    @Operation(summary = "라이브 세션 조회", description = "라이브 세션의 기본 정보를 조회한다. 소유 강사 또는 활성 수강생만.")
    @GetMapping("/api/live-sessions/{sessionId}")
    public LiveSessionView get(@PathVariable UUID sessionId, Authentication authentication) {
        // 접근 게이트: 소유 강사이거나 활성 수강생만 세션 정보를 볼 수 있다(없으면 404, 미수강 403).
        // 없으면 아무 로그인 사용자나 임의 세션의 강사·일정·roomSid를 조회할 수 있었다(IDOR).
        accessGuard.requireCanAccess(sessionId, UUID.fromString(authentication.getName()));
        return liveSessionService.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
    }

    @Operation(summary = "라이브 시작", description = "세션을 강사가 라이브로 켠다. 같은 세션을 다시 눌러도 문제없이 진행 중 상태를 유지한다(멱등).")
    @PostMapping("/api/live-sessions/{sessionId}/start")
    public LiveSessionView start(@PathVariable UUID sessionId, Authentication authentication) {
        return liveSessionService.start(sessionId, UUID.fromString(authentication.getName()));
    }

    @Operation(summary = "라이브 세션 일정 수정", description = "예정 시각·입장창·예상 시간을 수정한다(강사). 라이브가 시작되기 전에만 가능하다. 보낸 필드만 바뀐다.")
    @PatchMapping("/api/instructor/live-sessions/{sessionId}")
    public LiveSessionView updateSchedule(@PathVariable UUID sessionId,
                                          @RequestBody(required = false) UpdateLiveSessionRequest request,
                                          Authentication authentication) {
        UpdateLiveSessionRequest r = request == null
                ? new UpdateLiveSessionRequest(null, null, null) : request;
        return liveSessionService.updateSchedule(sessionId, UUID.fromString(authentication.getName()),
                r.scheduledAt(), r.entryWindowMinutes(), r.expectedDurationMinutes());
    }

    @Operation(summary = "라이브 세션 취소", description = "예정된 세션을 시작 전에 취소한다(강사). 이미 시작·종료된 세션은 취소할 수 없다.")
    @PostMapping("/api/instructor/live-sessions/{sessionId}/cancel")
    public LiveSessionView cancel(@PathVariable UUID sessionId, Authentication authentication) {
        return liveSessionService.cancel(sessionId, UUID.fromString(authentication.getName()));
    }

    @Operation(summary = "방 참여자 목록", description = "지금 라이브 방에 접속해 있는 참여자를 조회한다(강사). 실제 LiveKit 서버에서 가져온다.")
    @GetMapping("/api/instructor/live-sessions/{sessionId}/participants")
    public List<ParticipantView> participants(@PathVariable UUID sessionId, Authentication authentication) {
        return liveSessionService.listParticipants(sessionId, UUID.fromString(authentication.getName())).stream()
                .map(ParticipantView::from)
                .toList();
    }

    @Operation(summary = "참여자 강퇴", description = "특정 참여자를 방에서 내보낸다(강사). 실제 LiveKit 서버에 명령한다.")
    @DeleteMapping("/api/instructor/live-sessions/{sessionId}/participants/{identity}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeParticipant(@PathVariable UUID sessionId, @PathVariable String identity,
                                  Authentication authentication) {
        liveSessionService.removeParticipant(sessionId, UUID.fromString(authentication.getName()), identity);
    }

    @Operation(summary = "라이브 종료", description = "진행 중인 라이브를 강사가 끝낸다. 이미 종료됐어도 문제없이 종료 상태를 유지한다(멱등).")
    @PostMapping("/api/live-sessions/{sessionId}/end")
    public LiveSessionView end(@PathVariable UUID sessionId, Authentication authentication) {
        return liveSessionService.end(sessionId, UUID.fromString(authentication.getName()));
    }

    /**
     * 방 입장 토큰 발급. 요청자가 세션 강사면 publisher(송출+구독), 아니면 subscriber(구독 전용).
     * 세션 LIVE 상태 검사(입장창 등)는 후속. 접근 권한은 accessGuard가 수강 기반으로 검증한다.
     */
    @Operation(summary = "LiveKit 토큰 발급", description = "라이브 방에 접속할 입장 토큰을 발급한다. 세션을 만든 강사는 화면·음성을 내보낼 수 있고(송출), 그 외 참여자는 시청만 할 수 있다. 소유 강사 또는 활성 수강생만 발급된다.")
    @PostMapping("/api/live-sessions/{sessionId}/token")
    public LiveTokenResponse token(@PathVariable UUID sessionId, Authentication authentication) {
        LiveSessionView session = liveSessionService.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));

        String requesterId = authentication.getName();
        // 접근 게이트: 소유 강사이거나 소속 커리큘럼의 활성 수강생만. 아니면 403.
        accessGuard.requireCanAccess(sessionId, UUID.fromString(requesterId));
        // 상태 게이트: 종료·취소·실패한 세션엔 입장 토큰을 발급하지 않는다(끝난/취소된 방 재입장 차단).
        // 게이트를 접근검증 뒤에 둬서 미수강자에겐 세션 상태를 흘리지 않는다. enum 비교라 오타로 fail-open 안 된다.
        LiveSessionStatus liveStatus = LiveSessionStatus.valueOf(session.liveSessionStatus());
        if (liveStatus == LiveSessionStatus.ENDED
                || liveStatus == LiveSessionStatus.CANCELLED
                || liveStatus == LiveSessionStatus.FAILED) {
            throw new LiveSessionStateConflictException("종료되었거나 취소된 세션에는 입장할 수 없습니다.");
        }
        boolean publisher = requesterId.equals(session.instructorId().toString());
        // 방 이름은 세션 ID로 결정론적으로 만든다. LiveKit이 붙이는 room_sid는 실제 시작 시 채운다.
        String room = "session-" + sessionId;
        // 참가자 identity는 원시 userId를 노출하지 않는 (session,user) 결정론적 불투명 값으로 만든다.
        // 방 안에서 참가자끼리 서로의 identity를 보므로, 채팅 익명화와 동일하게 userId를 미디어 계층에 흘리지 않는다.
        String identity = UUID.nameUUIDFromBytes(
                (sessionId + ":" + requesterId).getBytes(StandardCharsets.UTF_8)).toString();

        // displayName(참여자 표시명·수강생 익명화)은 화면 요구가 붙을 때 채운다 — 지금은 불투명 식별자만.
        var issued = tokenService.issue(room, identity, null, publisher);

        return new LiveTokenResponse(
                "LIVEKIT",
                tokenService.url(),
                issued.jwt(),
                issued.expiresAt(),
                new LiveTokenResponse.Participant(identity, null),
                new LiveTokenResponse.Grants(true, publisher, publisher));
    }
}
