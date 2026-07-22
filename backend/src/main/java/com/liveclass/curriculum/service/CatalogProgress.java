package com.liveclass.curriculum.service;

/**
 * 수강생의 이 커리큘럼 진도. 학습 기록 도메인(CP5)이 아직 없어 현재는 항상 null로 나간다 —
 * 필드 형태만 계약에 못박아 두고, 기록이 생기면 여기만 채우면 FE는 그대로 동작한다.
 */
public record CatalogProgress(
        int completedLessonCount,
        int totalLessonCount,
        int progressPercent,
        CatalogLastLearning lastLearning
) {
    /** 마지막으로 학습하던 지점(레슨 + 세션 상대 ms). */
    public record CatalogLastLearning(java.util.UUID lessonId, long sessionMs) {
    }
}
