package com.liveclass.enrollment.api;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 수강 상태 조회 포트. 라이브 입장/채팅 게이팅(live), 내 수강 목록(enrollment web),
 * viewerContext·강사 로스터(curriculum)가 소비한다.
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

    /**
     * 강사용 수강 로스터 한 페이지(신청 순: requestedAt ASC, 동시각은 id ASC로 안정 정렬).
     *
     * @param status null이면 상태 필터 없이 전체
     */
    Page<EnrollmentView> findPage(UUID curriculumId, EnrollmentStatus status, Pageable pageable);

    /**
     * 이 커리큘럼의 상태별 수강 건수. 행을 적재하지 않고 집계 쿼리 1회로 센다.
     * 모든 {@link EnrollmentStatus} 키를 담아 돌려준다(해당 건이 없으면 0).
     */
    Map<EnrollmentStatus, Long> countsByStatus(UUID curriculumId);

    /**
     * 여러 커리큘럼의 ACTIVE 수강생 수를 한 번에(대시보드 합계 집계). 커리큘럼당 조회하면 N+1이라
     * 배치로 둔다. 수강 0인 커리큘럼은 맵에 키가 없다(호출자가 0으로 본다).
     */
    Map<UUID, Long> countActiveByCurriculums(java.util.Collection<UUID> curriculumIds);
}
