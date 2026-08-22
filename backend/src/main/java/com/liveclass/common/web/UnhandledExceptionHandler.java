package com.liveclass.common.web;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.orm.ObjectOptimisticLockingFailureException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.HttpRequestMethodNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * 전역 최후 방어선. 두 가지 역할:
 * 1) Spring MVC 표준 예외(잘못된 본문·없는 경로·메서드/미디어타입 불일치)를 올바른 4xx + 공통
 *    오류 봉투로 변환한다. 이렇게 명시하지 않으면 아래 Exception 핸들러가 500으로 삼켜버린다.
 * 2) 그 밖의 예상 못 한 예외는 500으로 내리되, 내부 메시지·스택트레이스는 본문에 노출하지 않고
 *    traceId와 함께 로그에만 남긴다.
 *
 * 우선순위를 가장 낮게 둬 도메인/검증 어드바이스가 먼저 처리하도록 한다.
 */
@Order(Ordered.LOWEST_PRECEDENCE)
@RestControllerAdvice
public class UnhandledExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(UnhandledExceptionHandler.class);

    /** 파싱 불가한 본문(잘못된 JSON·enum 등). */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ErrorResponse> handleUnreadable(HttpMessageNotReadableException e) {
        return status(HttpStatus.BAD_REQUEST, "MALFORMED_REQUEST", "요청 본문을 해석할 수 없습니다.");
    }

    /** 매핑된 핸들러가 없는 경로. */
    @ExceptionHandler(NoResourceFoundException.class)
    public ResponseEntity<ErrorResponse> handleNoResource(NoResourceFoundException e) {
        return status(HttpStatus.NOT_FOUND, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다.");
    }

    @ExceptionHandler(HttpRequestMethodNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleMethod(HttpRequestMethodNotSupportedException e) {
        return status(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "허용되지 않은 메서드입니다.");
    }

    @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
    public ResponseEntity<ErrorResponse> handleMediaType(HttpMediaTypeNotSupportedException e) {
        return status(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "지원하지 않는 미디어 타입입니다.");
    }

    /**
     * 낙관적 잠금(@Version) 충돌 = 동시 수정. 500이 아니라 409로 매핑한다 — 클라가 재시도하면 된다.
     * (LiveSession의 동시 start/end, Enrollment의 동시 상태전이 등에서 발생. CONTRACT §2 "중복 409".)
     */
    @ExceptionHandler(ObjectOptimisticLockingFailureException.class)
    public ResponseEntity<ErrorResponse> handleOptimisticLock(ObjectOptimisticLockingFailureException e) {
        return status(HttpStatus.CONFLICT, "CONCURRENT_MODIFICATION",
                "다른 요청과 동시에 변경되었습니다. 다시 시도해 주세요.");
    }

    /** 그 밖의 예상 못 한 예외 — 여기 오면 우리 코드/인프라 문제다. 스택트레이스를 로그로 남긴다. */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ErrorResponse> handleUnexpected(Exception e) {
        ErrorResponse body = ErrorResponse.of("INTERNAL_ERROR", "요청을 처리하지 못했습니다.");
        // traceId는 MDC에 있어 로그 패턴에 자동으로 붙는다. 본문 correlationId와 같은 값이다.
        log.error("처리되지 않은 예외 correlationId={}", body.correlationId(), e);
        return ErrorResponses.of(HttpStatus.INTERNAL_SERVER_ERROR, body);
    }

    // Content-Type을 고정한다 — Accept: text/event-stream인 SSE 요청에서 JSON 협상에 실패하면
    // 오류 봉투 대신 원래 예외가 그대로 새어나간다(ErrorResponses 참고).
    private ResponseEntity<ErrorResponse> status(HttpStatus status, String code, String message) {
        return ErrorResponses.of(status, code, message);
    }
}
