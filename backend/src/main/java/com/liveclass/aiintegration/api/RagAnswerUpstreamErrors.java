package com.liveclass.aiintegration.api;

import com.liveclass.common.web.ErrorResponse;
import com.liveclass.common.web.ErrorResponses;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * ai-api RAG 스트림을 <b>시작하지 못한</b> 실패의 응답 매핑(ADR-0047). 라이브(v1)와 다시보기(v2)가
 * 같은 코드를 내보내야 FE 분기가 하나로 유지되므로, 각 모듈의 advice가 이 팩토리를 공유한다.
 *
 * <p>업스트림 상태코드를 그대로 흘리지 않는다 — 특히 401(서명 거부)은 우리 설정·구현 문제인데
 * 브라우저에 401을 주면 FE가 세션 만료로 오해해 로그아웃 처리한다.
 */
public final class RagAnswerUpstreamErrors {

    private RagAnswerUpstreamErrors() {
    }

    public static ResponseEntity<ErrorResponse> toResponse(RagAnswerUpstreamException e) {
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
}
