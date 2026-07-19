package com.liveclass.live.api;

import java.util.UUID;

/**
 * 라이브 세션이 실제로 종료(ENDED 전이)돼 커밋됐을 때 발행된다(멱등 재종료는 발행 안 함).
 * 녹화 중지 등 정리 작업을 하는 다른 모듈이 커밋 후 best-effort로 반응한다.
 */
public record LiveSessionEndedEvent(
        UUID sessionId
) {
}
