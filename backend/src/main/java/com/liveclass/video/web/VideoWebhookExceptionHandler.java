package com.liveclass.video.web;

import com.liveclass.common.web.ErrorResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * webhook 검증 실패 → 401. 공용 {@code @ExceptionHandler(Exception.class)}가 먼저 잡아 500으로
 * 바꾸지 않도록 이 컨트롤러에 한정하고 우선순위를 높인다.
 */
@Order(Ordered.LOWEST_PRECEDENCE - 100)
@RestControllerAdvice(assignableTypes = LiveKitWebhookController.class)
public class VideoWebhookExceptionHandler {

    @ExceptionHandler(WebhookVerificationException.class)
    public ResponseEntity<ErrorResponse> handleVerification(WebhookVerificationException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ErrorResponse.of("WEBHOOK_UNVERIFIED", e.getMessage()));
    }
}
