package com.liveclass.live.web.dto;

import java.util.UUID;

/**
 * preflight 방 준비 응답(ADR-0002 §1). 강사 FE는 이 {@code roomName}으로 토큰을 받아 실제로 접속한다.
 * {@code roomSid}는 서버가 방을 만들었거나 기존 방을 확인했다는 증거다.
 */
public record LivePreflightRoomResponse(UUID sessionId, String roomName, String roomSid) {
}
