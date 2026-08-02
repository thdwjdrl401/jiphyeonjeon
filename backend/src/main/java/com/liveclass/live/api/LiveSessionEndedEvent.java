package com.liveclass.live.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 라이브 세션이 실제로 종료(ENDED 전이)돼 커밋됐을 때 발행된다(멱등 재종료는 발행 안 함).
 * 학생 화면은 이 이벤트부터 라이브 미디어 상태와 자막 시각 이동을 종료 상태로 바꾸되,
 * 채팅·AI 질문은 후속 토론을 위해 유지한다.
 */
public record LiveSessionEndedEvent(
        UUID sessionId,
        OffsetDateTime endedAt
) {
}
