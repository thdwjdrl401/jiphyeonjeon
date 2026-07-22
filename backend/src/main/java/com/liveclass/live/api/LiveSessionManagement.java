package com.liveclass.live.api;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 라이브 세션 변경 포트(쓰기). 조회는 {@link LiveSessionDirectory}가 담당한다.
 * 소유권·인가는 호출자(curriculum)가 책임지고, 이 포트는 데이터만 다룬다
 * — live 모듈은 curriculum에 의존하지 않는다(순환 금지).
 */
public interface LiveSessionManagement {

    /** 레슨에 라이브 세션을 만든다(레슨당 1개). scheduledAt이 있으면 SCHEDULED, 없으면 DRAFT. */
    LiveSessionView create(UUID lessonId, UUID curriculumId, UUID instructorId, OffsetDateTime scheduledAt);
}
