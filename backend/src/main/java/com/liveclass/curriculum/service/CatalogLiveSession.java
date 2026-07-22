package com.liveclass.curriculum.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/** 목차 레슨에 붙는 라이브 세션 요약. 레슨당 최대 하나. */
public record CatalogLiveSession(
        UUID sessionId,
        String status,
        OffsetDateTime scheduledAt
) {
}
