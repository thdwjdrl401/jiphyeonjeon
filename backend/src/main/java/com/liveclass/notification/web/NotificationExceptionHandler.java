package com.liveclass.notification.web;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.notification.service.NotificationNotFoundException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/*
 * 순서를 명시한다. UnhandledExceptionHandler가 Exception 전부를 LOWEST_PRECEDENCE로 받으므로,
 * 앞서지 않으면 우리 404가 그쪽 500에 먹힌다(다른 모듈 핸들러도 같은 값을 쓴다).
 */
@Order(Ordered.LOWEST_PRECEDENCE - 100)
@RestControllerAdvice(assignableTypes = NotificationController.class)
public class NotificationExceptionHandler {

    /**
     * 없는 알림과 <b>남의 알림</b>이 같은 404다. 403을 주면 "그 알림이 존재한다"는 사실이 샌다
     * (CONTRACT §2-4).
     */
    @ExceptionHandler(NotificationNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(NotificationNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("NOTIFICATION_NOT_FOUND", e.getMessage()));
    }
}
