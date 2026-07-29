package com.liveclass.live.web.dto;

import java.util.UUID;

/**
 * {@code POST /api/live-sessions/{sessionId}/start}의 {@code 202 Accepted} 본문(ADR-0002 §2).
 * FE는 {@code operationId}로 중복 클릭을 막고 시작 상태를 폴링한다.
 *
 * <p>{@link com.liveclass.live.api.LiveSessionView} 대신 전용 DTO를 쓴다 — 시작 접수는 "세션 스냅샷"이
 * 아니라 "오퍼레이션 접수"이고, LiveSessionView는 다른 여러 응답이 공유하므로 여기 전용 필드를 넣을 수 없다.
 */
public record LiveStartResponse(UUID operationId, UUID sessionId, String status) {
}
