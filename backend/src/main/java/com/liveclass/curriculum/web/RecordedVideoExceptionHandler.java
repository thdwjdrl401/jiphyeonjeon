package com.liveclass.curriculum.web;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.video.api.RecordedVideoConflictException;
import com.liveclass.video.api.RecordedVideoDisabledException;
import com.liveclass.video.api.RecordedVideoForbiddenException;
import com.liveclass.video.api.RecordedVideoInvalidException;
import com.liveclass.video.api.RecordedVideoNotFoundException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Order(Ordered.LOWEST_PRECEDENCE - 110)
@RestControllerAdvice(assignableTypes = InstructorRecordedLessonController.class)
public class RecordedVideoExceptionHandler {

    @ExceptionHandler(RecordedVideoNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(RecordedVideoNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("RECORDED_VIDEO_NOT_FOUND", e.getMessage()));
    }

    @ExceptionHandler(RecordedVideoConflictException.class)
    public ResponseEntity<ErrorResponse> handleConflict(RecordedVideoConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of(e.code(), e.getMessage()));
    }

    @ExceptionHandler(RecordedVideoInvalidException.class)
    public ResponseEntity<ErrorResponse> handleInvalid(RecordedVideoInvalidException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of(e.code(), e.getMessage()));
    }

    @ExceptionHandler(RecordedVideoDisabledException.class)
    public ResponseEntity<ErrorResponse> handleDisabled(RecordedVideoDisabledException e) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ErrorResponse.of(e.code(), e.getMessage()));
    }

    @ExceptionHandler(RecordedVideoForbiddenException.class)
    public ResponseEntity<ErrorResponse> handleForbidden(RecordedVideoForbiddenException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ErrorResponse.of("RECORDED_VIDEO_FORBIDDEN", e.getMessage()));
    }
}
