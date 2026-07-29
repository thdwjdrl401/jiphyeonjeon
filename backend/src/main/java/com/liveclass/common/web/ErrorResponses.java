package com.liveclass.common.web;

import org.springframework.http.HttpStatusCode;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;

/**
 * 오류 봉투 응답 팩토리. <b>Content-Type을 항상 명시</b>하는 게 요점이다.
 *
 * <p>명시하지 않으면 Spring이 요청 {@code Accept}로 협상하는데, SSE 요청은
 * {@code Accept: text/event-stream}이라 JSON을 못 쓰겠다며 협상에 실패하고 <b>원래 예외가 그대로
 * 새어나간다</b>(500/ServletException). 오류 봉투는 어떤 요청에서든 JSON이므로 여기서 못박는다
 * (ADR-0046 — 라이브 AI SSE 엔드포인트에서 403/404/400이 실제로 이 문제를 일으켰다).
 */
public final class ErrorResponses {

    private ErrorResponses() {
    }

    public static ResponseEntity<ErrorResponse> of(HttpStatusCode status, ErrorResponse body) {
        return ResponseEntity.status(status).contentType(MediaType.APPLICATION_JSON).body(body);
    }

    public static ResponseEntity<ErrorResponse> of(HttpStatusCode status, String code, String message) {
        return of(status, ErrorResponse.of(code, message));
    }
}
