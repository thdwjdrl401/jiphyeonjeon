package com.liveclass.enrollment.api;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 수강 상태 조회 포트. 라이브 입장/채팅 게이팅(live), 내 수강 목록(enrollment web),
 * viewerContext(curriculum)가 소비한다.
 */
public interface EnrollmentDirectory {

    /** 이 유저가 이 커리큘럼의 활성(ACTIVE) 수강생인가 — 접근제어 게이트용. */
    boolean isActive(UUID curriculumId, UUID userId);

    /** 이 유저의 이 커리큘럼 수강 기록(상태 무관, 있으면). */
    Optional<EnrollmentView> find(UUID curriculumId, UUID userId);

    /** enrollmentId로 조회(오케스트레이터가 소유 커리큘럼 소속인지 검증할 때). */
    Optional<EnrollmentView> findById(UUID enrollmentId);

    /** 내 수강 목록(최신순). */
    List<EnrollmentView> myEnrollments(UUID userId);
}
