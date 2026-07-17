package com.liveclass.auth.web;

import com.liveclass.auth.service.EmailDuplicatedException;
import com.liveclass.auth.service.InvalidCredentialsException;
import com.liveclass.common.web.ErrorResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 인증 도메인의 실패 → CONTRACT §2 상태코드(중복 409·인증실패 401)로 매핑. */
@RestControllerAdvice(assignableTypes = AuthController.class)
public class AuthExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(AuthExceptionHandler.class);

    @ExceptionHandler(EmailDuplicatedException.class)
    public ResponseEntity<ErrorResponse> handleEmailDuplicated(EmailDuplicatedException e) {
        return respond(HttpStatus.CONFLICT, ErrorResponse.of("AUTH_EMAIL_DUPLICATED", e.getMessage()));
    }

    @ExceptionHandler(InvalidCredentialsException.class)
    public ResponseEntity<ErrorResponse> handleInvalidCredentials(InvalidCredentialsException e) {
        return respond(HttpStatus.UNAUTHORIZED, ErrorResponse.of("AUTH_INVALID_CREDENTIALS", e.getMessage()));
    }

    /**
     * correlationId는 응답에만 있으면 쓸모가 없다 — 사용자가 들고 온 값으로 로그를 찾을 수 있어야 한다.
     * 어떤 이메일이었는지는 남기지 않는다(로그가 계정 존재 여부를 알려주면 안 된다).
     */
    private ResponseEntity<ErrorResponse> respond(HttpStatus status, ErrorResponse body) {
        log.info("인증 요청 거절 correlationId={} code={} status={}", body.correlationId(), body.code(), status.value());
        return ResponseEntity.status(status).body(body);
    }
}
