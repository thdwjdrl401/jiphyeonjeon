package com.liveclass.live.web;

import com.liveclass.live.service.LiveAccessGuard;
import com.liveclass.live.service.LiveCaptionService;
import com.liveclass.live.web.dto.CaptionReloadItem;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/**
 * 자막 리로드(REST, 세션 기준). 실시간 전달은 WebSocket으로 별도이며(§3-6), 이건 새로고침·재연결 때
 * 저장된 자막을 세션-ms 순으로 복원하는 경로다(CAPTION-01). WS 델타 payload와 정합(같은 필드,
 * 근사 sessionMs 포함, ADR-0045)해 FE가 그대로 누적기에 시드할 수 있다.
 *
 * <p>인가는 세션 참가자(소유 강사 또는 활성 수강생)만 — {@code ChatController}·{@code LiveSessionController.get}과
 * 같은 게이트({@link LiveAccessGuard})를 쓴다.
 */
@Tag(name = "라이브 자막", description = "자막 리로드(REST, 세션 기준). 실시간 전달은 WebSocket으로 별도.")
@RestController
public class CaptionController {

    private final LiveCaptionService liveCaptionService;
    private final LiveAccessGuard accessGuard;

    public CaptionController(LiveCaptionService liveCaptionService, LiveAccessGuard accessGuard) {
        this.liveCaptionService = liveCaptionService;
        this.accessGuard = accessGuard;
    }

    @Operation(summary = "자막 리로드 조회",
            description = "저장된 자막을 세션-ms 순으로 불러온다. 새로고침·재연결 뒤 자막 복원용. "
                    + "각 항목은 WS 델타/종료 payload와 같은 필드이며 근사 sessionMs를 포함한다.")
    @GetMapping("/api/live-sessions/{sessionId}/captions")
    public List<CaptionReloadItem> captions(@PathVariable UUID sessionId, Authentication authentication) {
        // 접근 게이트: 소유 강사이거나 활성 수강생만(없으면 404, 미수강 403). 세션 조회·채팅과 같은 규칙.
        accessGuard.requireCanAccess(sessionId, UUID.fromString(authentication.getName()));
        return liveCaptionService.reload(sessionId);
    }
}
