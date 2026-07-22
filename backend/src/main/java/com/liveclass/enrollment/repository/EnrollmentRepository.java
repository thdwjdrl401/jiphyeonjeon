package com.liveclass.enrollment.repository;

import com.liveclass.enrollment.domain.Enrollment;
import com.liveclass.enrollment.api.EnrollmentStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface EnrollmentRepository extends JpaRepository<Enrollment, UUID> {

    Optional<Enrollment> findByCurriculumIdAndUserId(UUID curriculumId, UUID userId);

    List<Enrollment> findByUserIdOrderByCreatedAtDesc(UUID userId);

    Page<Enrollment> findByCurriculumId(UUID curriculumId, Pageable pageable);

    Page<Enrollment> findByCurriculumIdAndStatus(UUID curriculumId, EnrollmentStatus status, Pageable pageable);

    boolean existsByCurriculumIdAndUserIdAndStatus(UUID curriculumId, UUID userId, EnrollmentStatus status);

    /** 상태별 건수 집계 — 로스터 summary용. 행을 적재하지 않고 DB에서 센다(쿼리 1회). */
    @Query("""
            select new com.liveclass.enrollment.repository.EnrollmentStatusCount(e.status, count(e))
            from Enrollment e
            where e.curriculumId = :curriculumId
            group by e.status
            """)
    List<EnrollmentStatusCount> countByStatus(@Param("curriculumId") UUID curriculumId);
}
