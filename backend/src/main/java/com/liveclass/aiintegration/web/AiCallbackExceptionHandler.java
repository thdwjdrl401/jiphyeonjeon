package com.liveclass.aiintegration.web;

import com.liveclass.common.web.ErrorResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * AI 콜백·자료 URL 발급의 서명 검증 실패 → 401. 공용 {@code @ExceptionHandler(Exception.class)}가 먼저 잡아
 * 500으로 바꾸지 않도록 이 두 컨트롤러에 한정하고 우선순위를 높인다(egress webhook 핸들러와 동일 패턴).
 */
@Order(Ordered.LOWEST_PRECEDENCE - 100)
@RestControllerAdvice(assignableTypes = {AiCallbackController.class, AiMaterialUrlController.class})
public class AiCallbackExceptionHandler {

    @ExceptionHandler(AiCallbackUnverifiedException.class)
    public ResponseEntity<ErrorResponse> handleVerification(AiCallbackUnverifiedException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ErrorResponse.of("AI_CALLBACK_UNVERIFIED", e.getMessage()));
    }
}
