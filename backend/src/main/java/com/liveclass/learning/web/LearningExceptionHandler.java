package com.liveclass.learning.web;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.learning.api.LessonNotLearnableException;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/**
 * 학습 자격 판정 실패 → 404/403 매핑. reason 으로 가른다:
 * NOT_FOUND(레슨·커리큘럼 없음, 존재 은닉) → 404, FORBIDDEN(있지만 미수강) → 403.
 */
@Order(Ordered.LOWEST_PRECEDENCE - 100)
@RestControllerAdvice(assignableTypes = LearningController.class)
public class LearningExceptionHandler {

    @ExceptionHandler(LessonNotLearnableException.class)
    public ResponseEntity<ErrorResponse> handleNotLearnable(LessonNotLearnableException e) {
        if (e.reason() == LessonNotLearnableException.Reason.NOT_FOUND) {
            return ResponseEntity.status(HttpStatus.NOT_FOUND)
                    .body(ErrorResponse.of("LESSON_NOT_FOUND", e.getMessage()));
        }
        // 공개 목차가 이미 레슨의 존재를 드러내므로 숨길 것이 없다 — 미수강은 403.
        // 코드는 목차 access.reasonCode와 같은 값으로 FE가 같은 분기(수강 동선)로 다룬다.
        return ResponseEntity.status(HttpStatus.FORBIDDEN)
                .body(ErrorResponse.of("ENROLLMENT_REQUIRED", e.getMessage()));
    }
}
