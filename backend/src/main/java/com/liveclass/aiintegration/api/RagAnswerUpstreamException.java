package com.liveclass.aiintegration.api;

/**
 * ai-api 스트림을 <b>시작하지 못한</b> 실패. SSE 헤더를 내보내기 전이므로 호출자가 평범한 JSON 오류로
 * 매핑한다(시작한 뒤의 실패는 {@code answer.error} 이벤트로 나간다).
 *
 * <p>업스트림 상태코드를 그대로 브라우저에 흘리지 않는다 — 특히 401(서명 거부)은 우리 설정·계약
 * 문제이지 사용자의 로그인 문제가 아니라서, 그대로 내보내면 FE가 "로그아웃됐다"고 오해한다
 * (SecurityConfig의 {@code /error} 주석과 같은 이유).
 */
public class RagAnswerUpstreamException extends RuntimeException {

    /** 브라우저에 내보낼 실패 종류. 업스트림 상태코드는 로그에만 남는다. */
    public enum Failure {
        /** ai-api가 RAG를 아직 못 받는 상태(503) 또는 연결 자체 실패. */
        UNAVAILABLE,
        /** requestId 재사용(409). 새 requestId로 다시 시도하면 된다. */
        REQUEST_CONFLICT,
        /** 400·401·406 등 우리 요청이 계약·인증에서 거부됨 — 설정·구현 문제. */
        REJECTED
    }

    private final Failure failure;
    private final Integer upstreamStatus;

    private RagAnswerUpstreamException(Failure failure, Integer upstreamStatus, String message, Throwable cause) {
        super(message, cause);
        this.failure = failure;
        this.upstreamStatus = upstreamStatus;
    }

    public static RagAnswerUpstreamException ofStatus(int status) {
        Failure failure = switch (status) {
            case 503 -> Failure.UNAVAILABLE;
            case 409 -> Failure.REQUEST_CONFLICT;
            default -> Failure.REJECTED;
        };
        return new RagAnswerUpstreamException(failure, status, "ai-api RAG 스트림 시작 실패(status=" + status + ")", null);
    }

    /** 연결·타임아웃 실패 — 사용자 관점에서는 "AI 응답 준비 안 됨"과 같다. */
    public static RagAnswerUpstreamException transport(Throwable cause) {
        return new RagAnswerUpstreamException(Failure.UNAVAILABLE, null, "ai-api RAG 스트림 연결 실패", cause);
    }

    public Failure failure() {
        return failure;
    }

    /** 업스트림 상태코드(연결 실패면 null). 로그·진단용이며 응답 본문에 넣지 않는다. */
    public Integer upstreamStatus() {
        return upstreamStatus;
    }
}
