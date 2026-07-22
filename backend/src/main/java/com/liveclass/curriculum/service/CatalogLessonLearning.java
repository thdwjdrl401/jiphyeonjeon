package com.liveclass.curriculum.service;

/** 이 레슨에 대한 내 학습 상태. learning 패키지가 배선되지 않아 항상 null이다(ADR-0024). */
public record CatalogLessonLearning(
        boolean completed,
        int progressPercent
) {
}
