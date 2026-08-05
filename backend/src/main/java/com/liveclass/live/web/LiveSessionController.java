package com.liveclass.live.web;

import com.liveclass.live.api.LiveSessionView;
import com.liveclass.live.domain.LiveSessionStatus;
import com.liveclass.live.service.LiveKitTokenService;
import com.liveclass.live.service.LiveAccessGuard;
import com.liveclass.live.service.LiveEndOrchestrator;
import com.liveclass.live.service.LiveParticipantIdentity;
import com.liveclass.live.service.LivePreflightService;
import com.liveclass.live.service.LiveProcessingService;
import com.liveclass.live.service.LiveLectureNoteService;
import com.liveclass.live.service.LivePresenceRegistry;
import com.liveclass.live.service.LiveSessionForbiddenException;
import com.liveclass.live.service.LiveSessionNotFoundException;
import com.liveclass.live.service.LiveSessionService;
import com.liveclass.live.service.LiveSessionStateConflictException;
import com.liveclass.live.service.LiveStartOrchestrator;
import com.liveclass.live.web.dto.LivePreflightReadinessResponse;
import com.liveclass.live.web.dto.LivePreflightRoomResponse;
import com.liveclass.live.web.dto.LiveLectureNoteResponse;
import com.liveclass.live.web.dto.LiveProcessingResponse;
import com.liveclass.live.web.dto.LiveStartResponse;
import com.liveclass.live.web.dto.LiveStartStatusResponse;
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
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 라이브 세션 조회·토큰·시작/종료·일정수정·취소(live 모듈). 생성은 소유권 때문에 curriculum이 오케스트레이션한다.
 */
@Tag(name = "라이브 세션", description = "라이브 세션 생성(강사)·조회·토큰·시작/종료.")
@RestController
public class LiveSessionController {

    private final LiveSessionService liveSessionService;
    private final LiveEndOrchestrator endOrchestrator;
    private final LiveStartOrchestrator startOrchestrator;
    private final LivePreflightService preflightService;
    private final LiveKitTokenService tokenService;
    private final LiveAccessGuard accessGuard;
    private final LiveProcessingService processingService;
    private final LivePresenceRegistry presenceRegistry;
    private final LiveLectureNoteService lectureNoteService;

    public LiveSessionController(LiveSessionService liveSessionService, LiveEndOrchestrator endOrchestrator,
                                LiveStartOrchestrator startOrchestrator,
                                LivePreflightService preflightService, LiveKitTokenService tokenService,
                                LiveAccessGuard accessGuard, LiveProcessingService processingService,
                                LivePresenceRegistry presenceRegistry,
                                LiveLectureNoteService lectureNoteService) {
        this.liveSessionService = liveSessionService;
        this.endOrchestrator = endOrchestrator;
        this.startOrchestrator = startOrchestrator;
        this.preflightService = preflightService;
        this.tokenService = tokenService;
        this.accessGuard = accessGuard;
        this.processingService = processingService;
        this.presenceRegistry = presenceRegistry;
        this.lectureNoteService = lectureNoteService;
    }

    @Operation(summary = "라이브 세션 조회",
            description = "라이브 세션의 기본 정보를 조회한다. 소유 강사 또는 활성 수강생만. "
                    + "지금 강의실에 있는 수강생 수(participantCount)를 함께 준다 — 이후 변화는 "
                    + "state 토픽의 session.presence로 온다(ADR-0060).")
    @GetMapping("/api/live-sessions/{sessionId}")
    public LiveSessionView get(@PathVariable UUID sessionId, Authentication authentication) {
        // 접근 게이트: 소유 강사이거나 활성 수강생만 세션 정보를 볼 수 있다(없으면 404, 미수강 403).
        // 없으면 아무 로그인 사용자나 임의 세션의 강사·일정·roomSid를 조회할 수 있었다(IDOR).
        accessGuard.requireCanAccess(sessionId, UUID.fromString(authentication.getName()));
        return liveSessionService.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."))
                // 조회 시점의 접속 현황. 이후 변화는 state 토픽으로 온다(ADR-0060).
                .withParticipantCount(presenceRegistry.audienceCount(sessionId));
    }

    @Operation(summary = "라이브 강의 노트 조회",
            description = "AI가 자막에서 만든 주제별 노트의 현재 전체를 준다(CONTRACT §3-4a). 증분이 아니라 늘 전체이며, "
                    + "이후 갱신은 notes 토픽의 lecture.note.updated로 온다. 소유 강사 또는 활성 수강생만.")
    @GetMapping("/api/live-sessions/{sessionId}/notes")
    public LiveLectureNoteResponse notes(@PathVariable UUID sessionId, Authentication authentication) {
        // 자막·채팅과 같은 게이트. 노트는 자막에서 파생된 것이라 자막을 볼 수 있는 사람이 볼 수 있다.
        accessGuard.requireCanReadContent(sessionId, UUID.fromString(authentication.getName()));
        return LiveLectureNoteResponse.from(lectureNoteService.find(sessionId));
    }

    @Operation(summary = "라이브 시작 요청",
            description = "세션을 STARTING으로 두고 시작 준비(STT dispatch·Egress·강사 마이크 확인)를 백그라운드로 진행한다. "
                    + "즉시 202와 operationId를 돌려주며, 실제 LIVE 전환은 start-status 또는 세션 조회로 관찰한다. "
                    + "같은 세션을 다시 눌러도 진행 중인 같은 시도를 돌려준다(멱등).")
    @PostMapping("/api/live-sessions/{sessionId}/start")
    @ResponseStatus(HttpStatus.ACCEPTED)
    public LiveStartResponse start(@PathVariable UUID sessionId, Authentication authentication) {
        LiveStartOrchestrator.StartOperation operation =
                startOrchestrator.start(sessionId, UUID.fromString(authentication.getName()));
        return new LiveStartResponse(operation.operationId(), operation.sessionId(), operation.status());
    }

    @Operation(summary = "라이브 시작 상태 조회",
            description = "STARTING 동안 FE가 폴링한다. 시작 시도의 진행 상태(IN_PROGRESS/SUCCEEDED/FAILED)와 실패 code, "
                    + "그리고 최신 세션 정보를 함께 돌려준다. operationId를 생략하면 가장 최근 시도를 본다.")
    @GetMapping("/api/live-sessions/{sessionId}/start-status")
    public LiveStartStatusResponse startStatus(@PathVariable UUID sessionId,
                                               @RequestParam(required = false) UUID operationId,
                                               Authentication authentication) {
        LiveStartOrchestrator.StartStatus status =
                startOrchestrator.status(sessionId, UUID.fromString(authentication.getName()), operationId);
        return new LiveStartStatusResponse(status.operationId(), status.attemptStatus(), status.step(),
                status.failureCode(), status.failureMessage(), status.session());
    }

    @Operation(summary = "preflight 방 준비",
            description = "강사가 preflight 화면에 들어올 때 1회 호출한다. LiveKit 방을 만들거나 기존 방을 재사용하고 roomSid를 저장한다(멱등).")
    @PostMapping("/api/instructor/live-sessions/{sessionId}/preflight")
    public LivePreflightRoomResponse preflight(@PathVariable UUID sessionId, Authentication authentication) {
        LivePreflightService.PreparedRoom room =
                preflightService.prepareRoom(sessionId, UUID.fromString(authentication.getName()));
        return new LivePreflightRoomResponse(room.sessionId(), room.roomName(), room.roomSid());
    }

    @Operation(summary = "preflight readiness 검사",
            description = "FE가 실제로 마이크를 publish한 뒤 호출한다. LiveKit 서버에서 participant·track을 다시 조회해 "
                    + "강사 존재·마이크 publish/unmute·예상 밖 마이크 publisher 없음을 판정한다. ready가 true일 때만 시작 버튼을 켠다.")
    @GetMapping("/api/instructor/live-sessions/{sessionId}/preflight/readiness")
    public LivePreflightReadinessResponse preflightReadiness(@PathVariable UUID sessionId,
                                                             Authentication authentication) {
        LivePreflightService.PreflightCheck check =
                preflightService.checkOwned(sessionId, UUID.fromString(authentication.getName()));
        return new LivePreflightReadinessResponse(check.ready(), check.instructorPresent(),
                check.microphonePublished(), check.microphoneMuted(), check.instructorMicrophoneTrackCount(),
                check.unexpectedMicrophonePublishers());
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
        return endOrchestrator.end(sessionId, UUID.fromString(authentication.getName()));
    }

    @Operation(summary = "종료 후 처리 현황 조회",
            description = "라이브 종료 뒤 녹화 자산이 어디까지 왔는지 조회한다(소유 강사). 라이브 종료와 녹화 완결은 "
                    + "별개 상태축이라, 세션이 ENDED여도 자산은 FINALIZING→VERIFYING→READY를 따로 지나간다. "
                    + "표시 문구는 담지 않는다 — 상태만 주고 FE가 문장을 고른다.")
    @GetMapping("/api/instructor/live-sessions/{sessionId}/processing")
    public LiveProcessingResponse processing(@PathVariable UUID sessionId, Authentication authentication) {
        return LiveProcessingResponse.from(
                processingService.get(sessionId, UUID.fromString(authentication.getName())));
    }

    /** 강사 WebRTC 송출 토큰 발급. 수강생은 LiveKit 방에 참여하지 않고 HLS로만 재생한다(ADR-0032). */
    @Operation(summary = "강사 LiveKit 토큰 발급",
            description = "세션 소유 강사에게만 화면·음성 송출용 LiveKit 토큰을 발급한다. 수강생 재생은 HLS 전용이다.")
    @PostMapping("/api/instructor/live-sessions/{sessionId}/token")
    public LiveTokenResponse token(@PathVariable UUID sessionId, Authentication authentication) {
        LiveSessionView session = liveSessionService.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));

        UUID requesterId = UUID.fromString(authentication.getName());
        if (!session.instructorId().equals(requesterId)) {
            throw new LiveSessionForbiddenException("이 세션의 강사만 LiveKit 토큰을 발급할 수 있습니다.");
        }
        // 상태 게이트: 종료·취소·실패한 세션엔 입장 토큰을 발급하지 않는다(끝난/취소된 방 재입장 차단).
        // 소유권 검사 뒤에 두며 enum 비교라 오타로 fail-open 하지 않는다.
        LiveSessionStatus liveStatus = LiveSessionStatus.valueOf(session.liveSessionStatus());
        if (liveStatus == LiveSessionStatus.ENDING
                || liveStatus == LiveSessionStatus.ENDED
                || liveStatus == LiveSessionStatus.CANCELLED
                || liveStatus == LiveSessionStatus.FAILED) {
            throw new LiveSessionStateConflictException("종료되었거나 취소된 세션에는 입장할 수 없습니다.");
        }
        // 방 이름은 세션 ID로 결정론적으로 만든다. LiveKit이 붙이는 room_sid는 실제 시작 시 채운다.
        String room = "session-" + sessionId;
        // preflight·Gate S3①의 서버측 조회가 같은 규칙으로 강사 participant를 찾는다.
        String identity = LiveParticipantIdentity.of(sessionId, requesterId);

        var issued = tokenService.issueInstructor(room, identity, null);

        return new LiveTokenResponse(
                "LIVEKIT",
                tokenService.url(),
                issued.jwt(),
                issued.expiresAt(),
                new LiveTokenResponse.Participant(identity, null),
                new LiveTokenResponse.Grants(true, true, true));
    }
}
