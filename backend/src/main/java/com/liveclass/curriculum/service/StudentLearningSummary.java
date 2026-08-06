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
 * @param upcomingLiveSession       가장 가까운 예정/진행 라이브(없으면 null)
 */
public record StudentLearningSummary(
        int inProgressCurriculumCount,
        int completedCurriculumCount,
        int averageProgress,
        int completedLessonCount,
        UpcomingLiveSession upcomingLiveSession
) {

    public static StudentLearningSummary empty() {
        return new StudentLearningSummary(0, 0, 0, 0, null);
    }

    /** 대시보드가 강조하는 다음 라이브 세션. FE {@code DashboardLiveSession}과 형태를 맞춘다. */
    /**
     * 가장 가까운 예정/진행 라이브 한 건.
     *
     * <p>{@code expectedDurationMinutes}는 <b>강사가 강의를 만들 때 입력한 예상 진행 시간</b>이다
     * (10~480분, {@code LiveSession}). 전에는 이 자리에 녹화 길이를 뜻하는 {@code durationMs}가
     * 있었는데, 예정된 라이브는 아직 녹화가 없어 구조적으로 영영 null이었다 — 화면은 "예상 --분"만
     * 보여 줬다. 이름과 값이 어긋난 자리였고, 뜻이 맞는 값으로 바꾼다.
     */
    public record UpcomingLiveSession(
            UUID sessionId,
            UUID lessonId,
            String lessonTitle,
            UUID curriculumId,
            String curriculumTitle,
            UUID sectionId,
            OffsetDateTime scheduledAt,
            String liveSessionStatus,
            Integer expectedDurationMinutes
    ) {
    }
}
