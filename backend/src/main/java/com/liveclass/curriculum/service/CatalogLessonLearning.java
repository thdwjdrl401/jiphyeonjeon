package com.liveclass.curriculum.service;

/** 이 레슨에 대한 내 학습 상태. 학습 기록 도메인(CP5)이 붙기 전까지는 항상 null로 나간다. */
public record CatalogLessonLearning(
        boolean completed,
        int progressPercent
) {
}
