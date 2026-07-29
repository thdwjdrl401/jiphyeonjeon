package com.liveclass.live.web;

import com.liveclass.common.web.ErrorResponse;
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
@RestControllerAdvice(assignableTypes = {LiveSessionController.class, ChatController.class, CaptionController.class})
public class LiveExceptionHandler {

    @ExceptionHandler(LiveSessionNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(LiveSessionNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("LIVE_SESSION_NOT_FOUND", e.getMessage()));
    }

    @ExceptionHandler(LiveSessionForbiddenException.class)
    public ResponseEntity<ErrorResponse> handleForbidden(LiveSessionForbiddenException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ErrorResponse.of("LIVE_SESSION_FORBIDDEN", e.getMessage()));
    }

    @ExceptionHandler(LiveSessionStateConflictException.class)
    public ResponseEntity<ErrorResponse> handleStateConflict(LiveSessionStateConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("LIVE_SESSION_STATE_CONFLICT", e.getMessage()));
    }

    /** LiveKit 서버 제어 실패 — 우리 잘못이 아닌 상위 서비스 오류 → 502. */
    @ExceptionHandler(LiveRoomControlException.class)
    public ResponseEntity<ErrorResponse> handleRoomControl(LiveRoomControlException e) {
        return ResponseEntity.status(HttpStatus.BAD_GATEWAY)
                .body(ErrorResponse.of("LIVE_ROOM_CONTROL_FAILED", "라이브 방 제어에 실패했습니다. 잠시 후 다시 시도해 주세요."));
    }
}
