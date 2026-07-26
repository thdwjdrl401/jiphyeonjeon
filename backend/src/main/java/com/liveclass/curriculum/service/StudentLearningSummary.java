package com.liveclass.curriculum.service;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 학생 학습 요약(대시보드 상단). 내 활성 수강들의 진도를 가로질러 집계한다 — 목록(/me/enrollments)과
 * 달리 카드 단위가 아니라 전체 합/평균이다. FE {@code StudentDashboardSummary}와 형태를 맞춘다.
 *
 * @param inProgressCurriculumCount 진행 중(활성 수강 중 완료 아님) 커리큘럼 수
 * @param completedCurriculumCount  완료(모든 게시 레슨 완료, 100%) 커리큘럼 수
 * @param averageProgress           활성 수강 전반의 평균 진도(0~100)
 * @param completedLessonCount      완료한 레슨 총합
 * @param todayLiveSession          가장 가까운 예정/진행 라이브(없으면 null)
 */
public record StudentLearningSummary(
        int inProgressCurriculumCount,
        int completedCurriculumCount,
        int averageProgress,
        int completedLessonCount,
        TodayLiveSession todayLiveSession
) {

    public static StudentLearningSummary empty() {
        return new StudentLearningSummary(0, 0, 0, 0, null);
    }

    /** 대시보드가 강조하는 다음 라이브 세션. FE {@code DashboardLiveSession}과 형태를 맞춘다. */
    public record TodayLiveSession(
            UUID sessionId,
            UUID lessonId,
            String lessonTitle,
            UUID curriculumId,
            String curriculumTitle,
            UUID sectionId,
            OffsetDateTime scheduledAt,
            String liveSessionStatus,
            Long durationMs
    ) {
    }
}
