package com.liveclass.enrollment.repository;

import com.liveclass.enrollment.domain.Enrollment;
import com.liveclass.enrollment.api.EnrollmentStatus;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;
import java.util.UUID;

public interface EnrollmentRepository extends JpaRepository<Enrollment, UUID> {

    Optional<Enrollment> findByCurriculumIdAndUserId(UUID curriculumId, UUID userId);

    List<Enrollment> findByUserIdOrderByCreatedAtDesc(UUID userId);

    List<Enrollment> findByCurriculumIdAndStatusOrderByRequestedAtAsc(UUID curriculumId, EnrollmentStatus status);

    boolean existsByCurriculumIdAndUserIdAndStatus(UUID curriculumId, UUID userId, EnrollmentStatus status);
}
