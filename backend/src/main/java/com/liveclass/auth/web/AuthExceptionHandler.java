package com.liveclass.auth.web;

import com.liveclass.auth.api.WithdrawalBlockedException;
import com.liveclass.auth.service.EmailDuplicatedException;
import com.liveclass.auth.service.InstructorOnlyException;
import com.liveclass.auth.service.InvalidCredentialsException;
import com.liveclass.auth.service.PasswordMismatchException;
import com.liveclass.auth.service.PasswordUnchangedException;
import com.liveclass.auth.service.ProfileImageInvalidException;
import com.liveclass.auth.service.TemporaryLoginRequiredException;
import com.liveclass.common.web.ErrorResponse;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.mail.MailException;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** 인증 도메인의 실패 → CONTRACT §2 상태코드(중복 409·인증실패 401)로 매핑. */
// 범용 Exception 핸들러보다 먼저 뽑히도록 우선순위를 명시한다.
@Order(Ordered.LOWEST_PRECEDENCE - 100)
@RestControllerAdvice(assignableTypes = {AuthController.class, AccountController.class})
public class AuthExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(AuthExceptionHandler.class);

    @ExceptionHandler(EmailDuplicatedException.class)
    public ResponseEntity<ErrorResponse> handleEmailDuplicated(EmailDuplicatedException e) {
        return respond(HttpStatus.CONFLICT, ErrorResponse.of("AUTH_EMAIL_DUPLICATED", e.getMessage()));
    }

    /** 유효하지 않은 프로필 이미지 에셋 참조 → 400(잘못된 요청). */
    @ExceptionHandler(ProfileImageInvalidException.class)
    public ResponseEntity<ErrorResponse> handleProfileImageInvalid(ProfileImageInvalidException e) {
        return respond(HttpStatus.BAD_REQUEST, ErrorResponse.of("AUTH_PROFILE_IMAGE_INVALID", e.getMessage()));
    }

    /**
     * 임시 비밀번호 메일 발송 실패 → 502.
     *
     * <p>비밀번호는 <b>바뀌지 않았다</b> — 발송이 실패하면 트랜잭션이 함께 되돌아간다
     * (AuthService.issueTemporaryPassword). 그래서 "다시 시도해 주세요"가 정직한 안내다.
     *
     * <p>500으로 흘리면 화면이 "서버 오류"로 읽고, 사용자는 비밀번호가 이미 바뀌었는지 아닌지
     * 모른 채 기다리게 된다.
     */
    @ExceptionHandler(MailException.class)
    public ResponseEntity<ErrorResponse> handleMailFailure(MailException e) {
        log.warn("임시 비밀번호 메일 발송 실패 — 비밀번호는 바뀌지 않았다", e);
        return respond(HttpStatus.BAD_GATEWAY, ErrorResponse.of("MAIL_DELIVERY_FAILED",
                "메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요."));
    }

    /** 임시 비밀번호 로그인 세션이 아닌데 그 전용 경로를 불렀다 → 409(상태 충돌). */
    @ExceptionHandler(TemporaryLoginRequiredException.class)
    public ResponseEntity<ErrorResponse> handleTemporaryLoginRequired(TemporaryLoginRequiredException e) {
        return respond(HttpStatus.CONFLICT, ErrorResponse.of("TEMPORARY_LOGIN_REQUIRED", e.getMessage()));
    }

    @ExceptionHandler(InvalidCredentialsException.class)
    public ResponseEntity<ErrorResponse> handleInvalidCredentials(InvalidCredentialsException e) {
        return respond(HttpStatus.UNAUTHORIZED, ErrorResponse.of("AUTH_INVALID_CREDENTIALS", e.getMessage()));
    }

    /** 비밀번호 변경 시 현재 비밀번호 불일치 → 401(로그인 실패와 같은 계열). */
    @ExceptionHandler(PasswordMismatchException.class)
    public ResponseEntity<ErrorResponse> handlePasswordMismatch(PasswordMismatchException e) {
        return respond(HttpStatus.UNAUTHORIZED, ErrorResponse.of("AUTH_PASSWORD_MISMATCH", e.getMessage()));
    }

    /** 비밀번호 변경 시 새 비밀번호가 현재 비밀번호와 같음 → 409(계정 상태 충돌). */
    @ExceptionHandler(PasswordUnchangedException.class)
    public ResponseEntity<ErrorResponse> handlePasswordUnchanged(PasswordUnchangedException e) {
        return respond(HttpStatus.CONFLICT, ErrorResponse.of("AUTH_PASSWORD_UNCHANGED", e.getMessage()));
    }

    /** 강사 전용 리소스에 비강사 접근 → 403. */
    @ExceptionHandler(InstructorOnlyException.class)
    public ResponseEntity<ErrorResponse> handleInstructorOnly(InstructorOnlyException e) {
        return respond(HttpStatus.FORBIDDEN, ErrorResponse.of("AUTH_INSTRUCTOR_ONLY", e.getMessage()));
    }

    /** 진행 중인 라이브 등으로 지금은 탈퇴할 수 없음 → 409. */
    @ExceptionHandler(WithdrawalBlockedException.class)
    public ResponseEntity<ErrorResponse> handleWithdrawalBlocked(WithdrawalBlockedException e) {
        return respond(HttpStatus.CONFLICT, ErrorResponse.of("AUTH_WITHDRAWAL_BLOCKED", e.getMessage()));
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
