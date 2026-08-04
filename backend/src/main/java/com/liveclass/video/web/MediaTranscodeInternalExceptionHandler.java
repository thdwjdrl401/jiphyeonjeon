package com.liveclass.video.web;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.video.service.MediaTranscodeCallbackInvalidException;
import com.liveclass.video.service.MediaTranscodeStorageUnavailableException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@Order(Ordered.LOWEST_PRECEDENCE - 120)
@RestControllerAdvice(assignableTypes = MediaTranscodeInternalController.class)
public class MediaTranscodeInternalExceptionHandler {

    @ExceptionHandler(MediaWorkerUnauthorizedException.class)
    public ResponseEntity<ErrorResponse> handleUnauthorized(MediaWorkerUnauthorizedException e) {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(ErrorResponse.of("MEDIA_WORKER_UNAUTHORIZED", e.getMessage()));
    }

    @ExceptionHandler(MediaTranscodeCallbackInvalidException.class)
    public ResponseEntity<ErrorResponse> handleInvalid(MediaTranscodeCallbackInvalidException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST)
                .body(ErrorResponse.of("MEDIA_TRANSCODE_CALLBACK_INVALID", e.getMessage()));
    }

    @ExceptionHandler(MediaTranscodeStorageUnavailableException.class)
    public ResponseEntity<ErrorResponse> handleStorage(MediaTranscodeStorageUnavailableException e) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ErrorResponse.of("MEDIA_STORAGE_UNAVAILABLE", e.getMessage()));
    }
}
