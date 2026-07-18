package com.liveclass.live.web;

import com.liveclass.live.api.LiveSessionManagement;
import com.liveclass.live.api.LiveSessionView;
import com.liveclass.live.service.LiveSessionNotFoundException;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/**
 * 라이브 세션 조회·토큰·시작/종료(live 모듈). 생성은 소유권 때문에 curriculum이 오케스트레이션한다.
 * 지금은 조회 골격만 — 토큰·시작/종료는 후속.
 */
@Tag(name = "라이브 세션", description = "라이브 세션 조회·토큰·시작/종료.")
@RestController
public class LiveSessionController {

    private final LiveSessionManagement liveSessionManagement;

    public LiveSessionController(LiveSessionManagement liveSessionManagement) {
        this.liveSessionManagement = liveSessionManagement;
    }

    @Operation(summary = "라이브 세션 조회", description = "역할별 상세는 후속. 현재는 기본 정보.")
    @GetMapping("/api/live-sessions/{sessionId}")
    public LiveSessionView get(@PathVariable UUID sessionId) {
        return liveSessionManagement.findById(sessionId)
                .orElseThrow(() -> new LiveSessionNotFoundException("라이브 세션을 찾을 수 없습니다."));
    }
}
