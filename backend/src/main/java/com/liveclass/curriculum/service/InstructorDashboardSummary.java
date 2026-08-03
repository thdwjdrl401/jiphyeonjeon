package com.liveclass.curriculum.service;

/**
 * 강사 대시보드 요약(내 커리큘럼 상단). 내 커리큘럼 전반의 운영 지표를 가로질러 집계한다 —
 * 목록(/instructor/curriculums)과 달리 카드 단위가 아니라 전체 합/개수다.
 * FE {@code InstructorDashboardSummary}와 형태를 맞춘다.
 *
 * @param totalCurriculumCount     내 커리큘럼 수(상태 무관)
 * @param publishedCurriculumCount 공개(PUBLISHED) 커리큘럼 수
 * @param upcomingLiveCount        예정/진행 라이브가 걸린 커리큘럼 수(커리큘럼당 다음 세션 1개 기준)
 * @param totalEnrolleeCount       내 커리큘럼 전반의 ACTIVE 수강생 합
 * @param upcomingLiveSession      가장 가까운 예정/진행 라이브(없으면 null) — 학생 요약과 같은 형태를 재사용
 */
public record InstructorDashboardSummary(
        int totalCurriculumCount,
        int publishedCurriculumCount,
        int upcomingLiveCount,
        long totalEnrolleeCount,
        StudentLearningSummary.UpcomingLiveSession upcomingLiveSession
) {
    public static InstructorDashboardSummary empty() {
        return new InstructorDashboardSummary(0, 0, 0, 0L, null);
    }
}
