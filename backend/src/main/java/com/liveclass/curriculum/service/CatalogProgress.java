package com.liveclass.curriculum.service;

/**
 * 수강생의 이 커리큘럼 진도(ADR-0033). 활성 수강자에게만 채워지고, 그 외에는 null이다.
 *
 * <p>{@code progressPercent}는 레슨별 진도율의 평균이 아니라 <b>몇 강을 끝냈나</b>다
 * ({@code completedLessonCount / totalLessonCount}) — 사용자에게 직관적이고 함께 내려보내는
 * 두 필드와 어긋나지 않는다.
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
