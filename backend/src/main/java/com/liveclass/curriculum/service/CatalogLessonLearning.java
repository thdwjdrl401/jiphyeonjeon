package com.liveclass.curriculum.service;

/**
 * 이 레슨에 대한 내 학습 상태(ADR-0033). {@code completed}는 진도율이 아니라 {@code completed_at}
 * 유무에서 온다 — 90%를 한 번 넘으면 sticky라 그 뒤 진도율이 내려가도 완료로 남는다.
 */
public record CatalogLessonLearning(
        boolean completed,
        int progressPercent
) {
}
