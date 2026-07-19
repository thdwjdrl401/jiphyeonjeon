package com.liveclass.live.api;

import java.time.OffsetDateTime;
import java.util.Optional;
import java.util.UUID;

/**
 * 라이브 세션 데이터 포트. 소유권·인가는 호출자(curriculum)가 책임지고, 이 포트는 데이터만 다룬다
 * — live 모듈은 curriculum에 의존하지 않는다(순환 금지).
 */
public interface LiveSessionManagement {

    /** 레슨에 라이브 세션을 만든다(레슨당 1개). scheduledAt이 있으면 SCHEDULED, 없으면 DRAFT. */
    LiveSessionView create(UUID lessonId, UUID instructorId, OffsetDateTime scheduledAt);

    Optional<LiveSessionView> findById(UUID sessionId);

    boolean existsForLesson(UUID lessonId);
}
