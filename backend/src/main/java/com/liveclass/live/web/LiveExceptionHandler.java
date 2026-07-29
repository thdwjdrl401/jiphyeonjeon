package com.liveclass.live.web;

import com.liveclass.aiintegration.api.RagAnswerUpstreamException;
import com.liveclass.common.web.ErrorResponse;
import com.liveclass.common.web.ErrorResponses;
import com.liveclass.live.service.LiveRoomControlException;
import com.liveclass.live.service.LiveSessionForbiddenException;
import com.liveclass.live.service.LiveSessionNotFoundException;
import com.liveclass.live.service.LiveSessionStateConflictException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** live 도메인 실패 → CONTRACT §2 상태코드 매핑. */
@Order(Ordered.LOWEST_PRECEDENCE - 100)
@RestControllerAdvice(assignableTypes = {LiveSessionController.class, ChatController.class, CaptionController.class,
        LiveAiAnswerController.class})
public class LiveExceptionHandler {

    @ExceptionHandler(LiveSessionNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(LiveSessionNotFoundException e) {
        return ErrorResponses.of(HttpStatus.NOT_FOUND,
                ErrorResponse.of("LIVE_SESSION_NOT_FOUND", e.getMessage()));
    }

    @ExceptionHandler(LiveSessionForbiddenException.class)
    public ResponseEntity<ErrorResponse> handleForbidden(LiveSessionForbiddenException e) {
        return ErrorResponses.of(HttpStatus.FORBIDDEN,
                ErrorResponse.of("LIVE_SESSION_FORBIDDEN", e.getMessage()));
    }

    @ExceptionHandler(LiveSessionStateConflictException.class)
    public ResponseEntity<ErrorResponse> handleStateConflict(LiveSessionStateConflictException e) {
        return ErrorResponses.of(HttpStatus.CONFLICT,
                ErrorResponse.of("LIVE_SESSION_STATE_CONFLICT", e.getMessage()));
    }

    /**
     * ai-api RAG 스트림을 <b>시작하지 못한</b> 실패(ADR-0047). 아직 SSE 헤더 전이라 JSON 오류로 나간다.
     *
     * <p>업스트림 상태코드를 그대로 흘리지 않는다 — 특히 401(서명 거부)은 우리 설정·구현 문제인데
     * 브라우저에 401을 주면 FE가 세션 만료로 오해해 로그아웃 처리한다.
     */
    @ExceptionHandler(RagAnswerUpstreamException.class)
    public ResponseEntity<ErrorResponse> handleRagUpstream(RagAnswerUpstreamException e) {
        return switch (e.failure()) {
            case UNAVAILABLE -> ErrorResponses.of(HttpStatus.SERVICE_UNAVAILABLE,
                    ErrorResponse.of("AI_ANSWER_UNAVAILABLE",
                            "AI 응답을 아직 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."));
            case REQUEST_CONFLICT -> ErrorResponses.of(HttpStatus.CONFLICT,
                    ErrorResponse.of("AI_ANSWER_REQUEST_CONFLICT",
                            "같은 질문 요청이 이미 처리 중입니다. 다시 시도해 주세요."));
            case REJECTED -> ErrorResponses.of(HttpStatus.BAD_GATEWAY,
                    ErrorResponse.of("AI_ANSWER_UPSTREAM_REJECTED",
                            "AI 서비스가 요청을 거부했습니다. 잠시 후 다시 시도해 주세요."));
        };
    }

    /** LiveKit 서버 제어 실패 — 우리 잘못이 아닌 상위 서비스 오류 → 502. */
    @ExceptionHandler(LiveRoomControlException.class)
    public ResponseEntity<ErrorResponse> handleRoomControl(LiveRoomControlException e) {
        return ErrorResponses.of(HttpStatus.BAD_GATEWAY,
                ErrorResponse.of("LIVE_ROOM_CONTROL_FAILED", "라이브 방 제어에 실패했습니다. 잠시 후 다시 시도해 주세요."));
    }
}
