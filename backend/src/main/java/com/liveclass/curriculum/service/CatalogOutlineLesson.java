package com.liveclass.curriculum.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 공개 목차의 레슨(서비스 결과).
 *
 * <p>{@code replayStatus}·{@code durationMs}는 video 모듈의 녹화본에서 온다. 녹화가 없으면
 * NOT_READY, 라이브를 한 번 한 레슨은 DRAFT다(게시 검수 흐름이 없어 PUBLISHED에는 아직 도달하지 않는다).
 * {@code durationMs}는 녹화 완료 webhook이 채우는 값이라 그 경로 전까지는 녹화가 있어도 null이다.
 *
 * <p>{@code learning}은 <b>활성 수강자에게만</b> 채워진다(ADR-0033). 수강자라도 아직 진도 기록이
 * 없는 레슨은 null이다 — "0%"와 "안 본 강의"는 다르고, 화면이 그 둘을 갈라 그릴 수 있어야 한다.
 */
public record CatalogOutlineLesson(
        UUID lessonId,
        String title,
        int order,
        String status,
        String deliveryType,
        OffsetDateTime scheduledAt,
        Long durationMs,
        CatalogLiveSession liveSession,
        String replayStatus,
        String recordedPublicationStatus,
        CatalogLessonAccess access,
        CatalogLessonLearning learning
) {

    /** 목차를 다 만든 뒤 내 학습 상태만 얹는다 — 진도 조회는 수강자일 때만 하므로 순서가 갈린다. */
    public CatalogOutlineLesson withLearning(CatalogLessonLearning mine) {
        return new CatalogOutlineLesson(lessonId, title, order, status, deliveryType, scheduledAt,
                durationMs, liveSession, replayStatus, recordedPublicationStatus, access, mine);
    }
}
