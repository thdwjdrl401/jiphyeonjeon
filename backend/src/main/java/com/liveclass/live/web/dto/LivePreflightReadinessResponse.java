package com.liveclass.live.web.dto;

/**
 * preflight readiness 검사 응답(ADR-0002 §1). FE의 로컬 boolean이 아니라 LiveKit 서버에서 다시 조회한
 * participant·track 상태다. {@code ready}가 true일 때만 시작 버튼을 활성화한다.
 *
 * <p>같은 판정을 LIVE 직전 Gate S3①(§7)에서도 그대로 다시 한다 — 여기서 통과했더라도 STARTING 도중
 * 강사 연결이 끊기면 LIVE가 되지 않는다.
 */
public record LivePreflightReadinessResponse(boolean ready,
                                             boolean instructorPresent,
                                             boolean microphonePublished,
                                             boolean microphoneMuted,
                                             int instructorMicrophoneTrackCount,
                                             int unexpectedMicrophonePublishers) {
}
