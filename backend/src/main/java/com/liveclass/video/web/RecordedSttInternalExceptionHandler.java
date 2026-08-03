package com.liveclass.video.web;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.video.service.RecordedSttContractException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Order(Ordered.LOWEST_PRECEDENCE - 130)
@RestControllerAdvice(assignableTypes = RecordedSttInternalController.class)
public class RecordedSttInternalExceptionHandler {

    @ExceptionHandler(RecordedSttWorkerUnauthorizedException.class)
    public ResponseEntity<ErrorResponse> unauthorized(RecordedSttWorkerUnauthorizedException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ErrorResponse.of("RECORDED_STT_WORKER_UNAUTHORIZED", e.getMessage()));
    }

    @ExceptionHandler(RecordedSttContractException.class)
    public ResponseEntity<ErrorResponse> contract(RecordedSttContractException e) {
        return ResponseEntity.status(e.conflict() ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of(e.code(), e.getMessage()));
    }
}
