package com.liveclass.live.web;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.live.service.LiveSessionNotFoundException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** live 도메인 실패 → CONTRACT §2 상태코드 매핑. */
@Order(Ordered.LOWEST_PRECEDENCE - 100)
@RestControllerAdvice(assignableTypes = LiveSessionController.class)
public class LiveExceptionHandler {

    @ExceptionHandler(LiveSessionNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(LiveSessionNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("LIVE_SESSION_NOT_FOUND", e.getMessage()));
    }
}
