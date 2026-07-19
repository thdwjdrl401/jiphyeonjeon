package com.liveclass.common.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.List;
import java.util.Map;

/** 입력 검증 실패 → 프론트가 입력란에 붙일 수 있는 형태(API_MAP §2.3)로 변환한다. */
@Order(Ordered.LOWEST_PRECEDENCE)
@RestControllerAdvice
public class ValidationExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ValidationExceptionHandler.class);
    private static final String VALIDATION_FAILED = "VALIDATION_FAILED";
    private static final String MESSAGE = "입력값을 확인해 주세요.";

    /** Bean Validation 애노테이션 → 프론트가 아는 안정적인 코드로 매핑. */
    private static final Map<String, String> FIELD_ERROR_CODES = Map.of(
            "NotBlank", "REQUIRED",
            "NotNull", "REQUIRED",
            "NotEmpty", "REQUIRED",
            "Email", "INVALID_FORMAT",
            "Size", "INVALID_LENGTH",
            "BcryptSafeLength", "INVALID_LENGTH"
    );

    /** @RequestBody DTO 검증 실패. */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ErrorResponse> handleInvalidBody(MethodArgumentNotValidException e) {
        List<ErrorResponse.FieldErrorItem> fieldErrors = e.getBindingResult().getFieldErrors().stream()
                .map(error -> new ErrorResponse.FieldErrorItem(
                        error.getField(),
                        FIELD_ERROR_CODES.getOrDefault(error.getCode(), "INVALID")))
                .toList();
        return badRequest(ErrorResponse.of(VALIDATION_FAILED, MESSAGE, fieldErrors));
    }

    /**
     * @RequestParam·@PathVariable에 붙은 제약 위반(Spring 6.1+ 내장 메서드 검증).
     * 이걸 처리하지 않으면 500으로 새어나가 프론트가 계약된 코드를 못 받는다.
     */
    @ExceptionHandler(HandlerMethodValidationException.class)
    public ResponseEntity<ErrorResponse> handleInvalidParams(HandlerMethodValidationException e) {
        return badRequest(ErrorResponse.of(VALIDATION_FAILED, MESSAGE));
    }

    /** 필수 파라미터 자체가 빠진 경우. */
    @ExceptionHandler(MissingServletRequestParameterException.class)
    public ResponseEntity<ErrorResponse> handleMissingParam(MissingServletRequestParameterException e) {
        return badRequest(ErrorResponse.of(VALIDATION_FAILED, MESSAGE,
                List.of(new ErrorResponse.FieldErrorItem(e.getParameterName(), "REQUIRED"))));
    }

    /** 파라미터 타입 변환 실패(예: 잘못된 enum·UUID·정수). 무시하지 않고 400으로 응답. */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ErrorResponse> handleTypeMismatch(MethodArgumentTypeMismatchException e) {
        return badRequest(ErrorResponse.of(VALIDATION_FAILED, MESSAGE,
                List.of(new ErrorResponse.FieldErrorItem(e.getName(), "INVALID"))));
    }

    private ResponseEntity<ErrorResponse> badRequest(ErrorResponse body) {
        // correlationId는 남겨야 의미가 있다 — 사용자가 들고 온 값으로 로그를 찾을 수 있어야 한다.
        log.debug("검증 실패 correlationId={} code={}", body.correlationId(), body.code());
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(body);
    }
}
