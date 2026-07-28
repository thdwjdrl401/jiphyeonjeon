package com.liveclass.live.web.dto;

import com.liveclass.live.api.LiveSessionView;

import java.util.UUID;

/**
 * {@code GET /api/live-sessions/{sessionId}/start-status}의 응답. STARTING 동안 FE가 폴링한다.
 * 최신 세션 뷰를 함께 내려 FE가 세션을 따로 재조회하지 않고도 STARTING→LIVE 전환을 감지할 수 있게 한다.
 *
 * @param attemptStatus  {@code IN_PROGRESS}/{@code SUCCEEDED}/{@code FAILED}. 시도 이력이 없으면 null
 * @param failureCode    실패 시 안정적인 오류 code({@code EGRESS_NOT_READY}·{@code INSTRUCTOR_NOT_PUBLISHING} 등)
 */
public record LiveStartStatusResponse(UUID operationId, String attemptStatus, String step,
                                      String failureCode, String failureMessage,
                                      LiveSessionView session) {
}
