package com.liveclass.live.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 라이브 세션이 실제로 시작(LIVE 전이)돼 커밋됐을 때 발행된다(멱등 재시작은 발행 안 함).
 * 녹화 등 부가 처리를 하는 다른 모듈이 커밋 후 이 이벤트를 받아 best-effort로 반응한다 — 코어 세션
 * 시작을 막거나 되돌리지 않기 위해. {@code roomName}을 실어 소비 측이 세션 네이밍 규칙을 몰라도 되게 한다.
 *
 * <p>{@code startedAt}은 전이를 확정한 트랜잭션이 찍은 값이며 <b>세션 시계의 원점</b>이다
 * (§7, {@code clockOriginAt}과 같은 값). 소비 측이 발행 시각을 다시 찍으면 커밋과 수신 사이의 지연만큼
 * 원점이 밀리므로 이벤트에 실어 보낸다 — {@link LiveSessionEndedEvent}의 {@code endedAt}과 같은 규칙이다.
 */
public record LiveSessionStartedEvent(
        UUID sessionId,
        UUID lessonId,
        String roomName,
        boolean recordingEnabled,
        OffsetDateTime startedAt
) {
}
