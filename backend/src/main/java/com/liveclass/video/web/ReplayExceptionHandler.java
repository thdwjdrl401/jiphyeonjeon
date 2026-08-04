package com.liveclass.video.web;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.common.web.ErrorResponses;
import com.liveclass.aiintegration.api.RagAnswerUpstreamException;
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
@RestControllerAdvice(assignableTypes = {
        ReplayPlaybackController.class, RecordedPlaybackController.class, LessonAiAnswerController.class})
public class ReplayExceptionHandler {

    /** Replay v2 시작 실패. 상류 401을 그대로 보내 브라우저가 로그아웃으로 오해하지 않게 한다. */
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

    /** 접근 판정 실패 → 404(레슨 은닉)/403(미수강). 학습 게이트(ENROLLMENT_REQUIRED)와 같은 코드로 FE가 같은 분기. */
    @ExceptionHandler(PlaybackAccessException.class)
    public ResponseEntity<ErrorResponse> handleAccess(PlaybackAccessException e) {
        if (e.reason() == PlaybackAccessException.Reason.NOT_FOUND) {
            return ErrorResponses.of(HttpStatus.NOT_FOUND,
                    ErrorResponse.of("LESSON_NOT_FOUND", e.getMessage()));
        }
        return ErrorResponses.of(HttpStatus.FORBIDDEN,
                ErrorResponse.of("ENROLLMENT_REQUIRED", e.getMessage()));
    }

    @ExceptionHandler(ReplayNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleNotFound(ReplayNotFoundException e) {
        return ErrorResponses.of(HttpStatus.NOT_FOUND,
                ErrorResponse.of("REPLAY_NOT_FOUND", e.getMessage()));
    }

    @ExceptionHandler(RecordedVideoNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleRecordedNotFound(RecordedVideoNotFoundException e) {
        return ErrorResponses.of(HttpStatus.NOT_FOUND,
                ErrorResponse.of("RECORDED_VIDEO_NOT_FOUND", e.getMessage()));
    }

    @ExceptionHandler(RecordedCaptionNotFoundException.class)
    public ResponseEntity<ErrorResponse> handleRecordedCaptionNotFound(RecordedCaptionNotFoundException e) {
        return ErrorResponses.of(HttpStatus.NOT_FOUND,
                ErrorResponse.of("RECORDED_CAPTION_NOT_FOUND", e.getMessage()));
    }

    @ExceptionHandler(RecordedVideoConflictException.class)
    public ResponseEntity<ErrorResponse> handleRecordedConflict(RecordedVideoConflictException e) {
        return ErrorResponses.of(HttpStatus.CONFLICT,
                ErrorResponse.of(e.code(), e.getMessage()));
    }

    @ExceptionHandler(ReplayNotReadyException.class)
    public ResponseEntity<ErrorResponse> handleNotReady(ReplayNotReadyException e) {
        return ErrorResponses.of(HttpStatus.CONFLICT,
                ErrorResponse.of("REPLAY_NOT_READY", e.getMessage()));
    }

    @ExceptionHandler(ReplayPublishConflictException.class)
    public ResponseEntity<ErrorResponse> handlePublishConflict(ReplayPublishConflictException e) {
        return ErrorResponses.of(HttpStatus.CONFLICT,
                ErrorResponse.of("REPLAY_PUBLISH_CONFLICT", e.getMessage()));
    }

    @ExceptionHandler(ReplayForbiddenException.class)
    public ResponseEntity<ErrorResponse> handleForbidden(ReplayForbiddenException e) {
        return ErrorResponses.of(HttpStatus.FORBIDDEN,
                ErrorResponse.of("REPLAY_FORBIDDEN", e.getMessage()));
    }

    @ExceptionHandler(RecordingStartingException.class)
    public ResponseEntity<ErrorResponse> handleRecordingStarting(RecordingStartingException e) {
        return ErrorResponses.of(HttpStatus.CONFLICT,
                ErrorResponse.of("RECORDING_STARTING", e.getMessage()));
    }

    @ExceptionHandler(ReplayWithdrawWhileLiveException.class)
    public ResponseEntity<ErrorResponse> handleWithdrawWhileLive(ReplayWithdrawWhileLiveException e) {
        return ErrorResponses.of(HttpStatus.CONFLICT,
                ErrorResponse.of("REPLAY_WITHDRAW_WHILE_LIVE", e.getMessage()));
    }

    @ExceptionHandler(ReplayManifestInvalidException.class)
    public ResponseEntity<ErrorResponse> handleInvalidManifest(ReplayManifestInvalidException e) {
        return ErrorResponses.of(HttpStatus.CONFLICT,
                ErrorResponse.of("REPLAY_NOT_READY", e.getMessage()));
    }

    @ExceptionHandler(PlaybackStorageUnavailableException.class)
    public ResponseEntity<ErrorResponse> handleStorageUnavailable(PlaybackStorageUnavailableException e) {
        return ErrorResponses.of(HttpStatus.SERVICE_UNAVAILABLE,
                ErrorResponse.of("PLAYBACK_STORAGE_UNAVAILABLE", e.getMessage()));
    }
}
