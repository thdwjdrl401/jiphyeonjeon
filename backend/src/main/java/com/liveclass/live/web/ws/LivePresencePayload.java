package com.liveclass.live.web.ws;

/**
 * 접속자 수 WebSocket payload. 필드명은 공유 계약의 camelCase를 따른다.
 *
 * @param participantCount 지금 강의실에 들어와 있는 <b>수강생</b> 수. 강사는 포함하지 않는다.
 */
public record LivePresencePayload(int participantCount) {
}
