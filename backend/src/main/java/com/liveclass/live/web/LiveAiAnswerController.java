package com.liveclass.live.web;

import com.liveclass.aiintegration.api.RagAnswerCommand;
import com.liveclass.aiintegration.api.RagAnswerStreamHandle;
import com.liveclass.live.service.LiveAccessGuard;
import com.liveclass.live.service.LiveAiAnswerService;
import com.liveclass.live.web.dto.AiAnswerQuestionRequest;
import com.liveclass.live.web.dto.LiveAiAnswerHistoryResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import org.springframework.http.MediaType;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.List;
import java.util.UUID;

/**
 * 라이브 AI 질의응답 SSE 프록시(AI-QUESTION-01, ADR-0047). 브라우저는 Spring만 호출하고, Spring이
 * 인가·정책을 끝낸 뒤 ai-api의 RAG 스트림을 <b>변환 없이</b> 중계한다.
 *
 * <p><b>경로가 {@code /stream}으로 끝나는 것은 계약이다.</b> {@code frontend/nginx/default.conf}의
 * {@code location ~ ^/api/.+/stream$}만 {@code proxy_buffering off}를 적용한다 — 다른 접미사면
 * nginx가 토큰을 뭉쳐 실시간 스트리밍이 깨진다.
 *
 * <p>인가는 세션 참가자(소유 강사 또는 활성 수강생)만 — 자막 리로드({@link CaptionController})와
 * 같은 게이트({@link LiveAccessGuard})다.
 */
@Tag(name = "라이브 AI 질의응답", description = "세션 문맥 RAG 답변을 SSE로 중계한다.")
@RestController
public class LiveAiAnswerController {

    private final LiveAiAnswerService liveAiAnswerService;
    private final LiveAccessGuard accessGuard;

    public LiveAiAnswerController(LiveAiAnswerService liveAiAnswerService, LiveAccessGuard accessGuard) {
        this.liveAiAnswerService = liveAiAnswerService;
        this.accessGuard = accessGuard;
    }

    @Operation(summary = "라이브 AI 질문(SSE)",
            description = "ai-api의 answer.delta 0개 이상 + answer.done|answer.insufficient|answer.error 하나를 "
                    + "그대로 중계한다. lessonId·contextTimeMs·requestId는 서버가 채운다.")
    @PostMapping(value = "/api/live-sessions/{sessionId}/ai/answers/stream",
            produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter stream(@PathVariable UUID sessionId,
                             @Valid @RequestBody AiAnswerQuestionRequest request,
                             Authentication authentication) {
        // 접근 게이트: 소유 강사이거나 활성 수강생만(없으면 404, 미수강 403). 자막·채팅과 같은 규칙.
        UUID askedBy = UUID.fromString(authentication.getName());
        accessGuard.requireCanAccess(sessionId, askedBy);
        RagAnswerCommand command = liveAiAnswerService.prepare(sessionId, request.question());
        // 업스트림 헤더를 받을 때까지 여기서 블로킹한다 — 시작 실패는 SSE가 아직 안 열렸으므로
        // 평범한 JSON 오류(503/409/502)로 나간다(LiveExceptionHandler).
        RagAnswerStreamHandle handle = liveAiAnswerService.open(command);
        return liveAiAnswerService.relay(command, handle, askedBy);
    }

    @Operation(summary = "내 AI 질문 기록 조회",
            description = "이 세션에서 내가 한 질문과 받은 답변을 물어본 순서대로 돌려준다. 새로고침·재접속 뒤 "
                    + "대화를 되살리는 용도이며, 개인 질문이라 남의 것은 나오지 않는다.")
    @GetMapping("/api/live-sessions/{sessionId}/ai/answers")
    public List<LiveAiAnswerHistoryResponse> history(@PathVariable UUID sessionId,
                                                     Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        // 스트림과 같은 게이트. 세션에 못 들어가는 사람은 자기 기록도 조회하지 않는다.
        accessGuard.requireCanAccess(sessionId, userId);
        return liveAiAnswerService.history(sessionId, userId).stream()
                .map(LiveAiAnswerHistoryResponse::from)
                .toList();
    }
}
