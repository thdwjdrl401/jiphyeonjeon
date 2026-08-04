package com.liveclass.video.web;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.video.api.PlaybackAccessException;
import com.liveclass.video.api.RecordedVideoConflictException;
import com.liveclass.video.api.RecordedVideoNotFoundException;
import com.liveclass.video.api.RecordedCaptionNotFoundException;
import com.liveclass.video.service.PlaybackStorageUnavailableException;
import com.liveclass.video.service.RecordingStartingException;
import com.liveclass.video.service.ReplayForbiddenException;
import com.liveclass.video.service.ReplayManifestInvalidException;
import com.liveclass.video.service.ReplayNotFoundException;
import com.liveclass.video.service.ReplayNotReadyException;
import com.liveclass.video.service.ReplayPublishConflictException;
import com.liveclass.video.service.ReplayWithdrawWhileLiveException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 다시보기 재생·게시 실패 → CONTRACT §2 상태코드 매핑. 공용 {@code @ExceptionHandler(Exception.class)}가
 * 먼저 잡아 500으로 바꾸지 않도록 이 컨트롤러에 한정하고 우선순위를 높인다.
 */
@Order(Ordered.LOWEST_PRECEDENCE - 100)
@RestControllerAdvice(assignableTypes = {ReplayPlaybackController.class, RecordedPlaybackController.class})
public class ReplayExceptionHandler {

    /** 접근 판정 실패 → 404(레슨 은닉)/403(미수강). 학습 게이트(ENROLLMENT_REQUIRED)와 같은 코드로 FE가 같은 분기. */
    @ExceptionHandler(PlaybackAccessException.class)
    public ResponseEntity<ErrorResponse> handleAccess(PlaybackAccessException e) {
        if (e.reason() == PlaybackAccessException.Reason.NOT_FOUND) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("LESSON_NOT_FOUND", e.getMessage()));
        }
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ErrorResponse.of("ENROLLMENT_REQUIRED", e.getMessage()));
    }

    @ExceptionHandler(ReplayNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(ReplayNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("REPLAY_NOT_FOUND", e.getMessage()));
    }

    @ExceptionHandler(RecordedVideoNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleRecordedNotFound(RecordedVideoNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("RECORDED_VIDEO_NOT_FOUND", e.getMessage()));
    }

    @ExceptionHandler(RecordedCaptionNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleRecordedCaptionNotFound(RecordedCaptionNotFoundException e) {
        return ResponseEntity.status(HttpStatus.NOT_FOUND)
                .body(ErrorResponse.of("RECORDED_CAPTION_NOT_FOUND", e.getMessage()));
    }

    @ExceptionHandler(RecordedVideoConflictException.class)
    public ResponseEntity<ErrorResponse> handleRecordedConflict(RecordedVideoConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of(e.code(), e.getMessage()));
    }

    @ExceptionHandler(ReplayNotReadyException.class)
    public ResponseEntity<ErrorResponse> handleNotReady(ReplayNotReadyException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("REPLAY_NOT_READY", e.getMessage()));
    }

    @ExceptionHandler(ReplayPublishConflictException.class)
    public ResponseEntity<ErrorResponse> handlePublishConflict(ReplayPublishConflictException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("REPLAY_PUBLISH_CONFLICT", e.getMessage()));
    }

    @ExceptionHandler(ReplayForbiddenException.class)
    public ResponseEntity<ErrorResponse> handleForbidden(ReplayForbiddenException e) {
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ErrorResponse.of("REPLAY_FORBIDDEN", e.getMessage()));
    }

    @ExceptionHandler(RecordingStartingException.class)
    public ResponseEntity<ErrorResponse> handleRecordingStarting(RecordingStartingException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("RECORDING_STARTING", e.getMessage()));
    }

    @ExceptionHandler(ReplayWithdrawWhileLiveException.class)
    public ResponseEntity<ErrorResponse> handleWithdrawWhileLive(ReplayWithdrawWhileLiveException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("REPLAY_WITHDRAW_WHILE_LIVE", e.getMessage()));
    }

    @ExceptionHandler(ReplayManifestInvalidException.class)
    public ResponseEntity<ErrorResponse> handleInvalidManifest(ReplayManifestInvalidException e) {
        return ResponseEntity.status(HttpStatus.CONFLICT)
                .body(ErrorResponse.of("REPLAY_NOT_READY", e.getMessage()));
    }

    @ExceptionHandler(PlaybackStorageUnavailableException.class)
    public ResponseEntity<ErrorResponse> handleStorageUnavailable(PlaybackStorageUnavailableException e) {
        return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                .body(ErrorResponse.of("PLAYBACK_STORAGE_UNAVAILABLE", e.getMessage()));
    }
}
