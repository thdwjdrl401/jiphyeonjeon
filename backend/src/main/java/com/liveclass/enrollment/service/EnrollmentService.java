package com.liveclass.enrollment.service;

import com.liveclass.enrollment.api.EnrollmentDirectory;
import com.liveclass.enrollment.api.EnrollmentManagement;
import com.liveclass.enrollment.api.EnrollmentNotFoundException;
import com.liveclass.enrollment.api.EnrollmentStateConflictException;
import com.liveclass.enrollment.api.EnrollmentView;
import com.liveclass.enrollment.domain.Enrollment;
import com.liveclass.enrollment.api.EnrollmentStatus;
import com.liveclass.enrollment.repository.EnrollmentRepository;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

/**
 * 수강 상태기계. 커리큘럼 정책·소유권은 모른다(호출자 책임) — 여기선 전이 규칙만 강제한다.
 * 전이: 신청 → PENDING(승인제)/ACTIVE(즉시). 승인 PENDING→ACTIVE, 거절 PENDING→REJECTED,
 * 취소 PENDING/ACTIVE→CANCELLED, 강퇴 ACTIVE→REVOKED. 종료상태에서 재신청은 같은 행을 되살린다.
 */
@Service
public class EnrollmentService implements EnrollmentManagement, EnrollmentDirectory {

    private final EnrollmentRepository repository;

    public EnrollmentService(EnrollmentRepository repository) {
        this.repository = repository;
    }

    @Override
    @Transactional
    public EnrollmentView apply(UUID curriculumId, UUID userId, boolean requiresApproval) {
        EnrollmentStatus target = requiresApproval ? EnrollmentStatus.PENDING : EnrollmentStatus.ACTIVE;
        OffsetDateTime now = OffsetDateTime.now();

        Enrollment e = repository.findByCurriculumIdAndUserId(curriculumId, userId).orElse(null);
        if (e == null) {
            e = new Enrollment();
            e.setCurriculumId(curriculumId);
            e.setUserId(userId);
        } else if (e.getStatus() == EnrollmentStatus.PENDING || e.getStatus() == EnrollmentStatus.ACTIVE) {
            throw new EnrollmentStateConflictException("이미 신청했거나 수강 중입니다.");
        }
        // 신규 또는 종료상태(CANCELLED/REJECTED/REVOKED) 재신청 → 같은 행을 되살린다(UNIQUE 제약과 정합).
        e.setStatus(target);
        e.setRequestedAt(now);
        e.setDecidedAt(null);
        e.setEnrolledAt(target == EnrollmentStatus.ACTIVE ? now : null);
        return toView(repository.save(e));
    }

    @Override
    @Transactional
    public EnrollmentView approve(UUID enrollmentId) {
        Enrollment e = require(enrollmentId);
        if (e.getStatus() != EnrollmentStatus.PENDING) {
            throw new EnrollmentStateConflictException("승인 대기 상태가 아닙니다.");
        }
        OffsetDateTime now = OffsetDateTime.now();
        e.setStatus(EnrollmentStatus.ACTIVE);
        e.setDecidedAt(now);
        e.setEnrolledAt(now);
        return toView(e);
    }

    @Override
    @Transactional
    public EnrollmentView reject(UUID enrollmentId) {
        Enrollment e = require(enrollmentId);
        if (e.getStatus() != EnrollmentStatus.PENDING) {
            throw new EnrollmentStateConflictException("승인 대기 상태가 아닙니다.");
        }
        e.setStatus(EnrollmentStatus.REJECTED);
        e.setDecidedAt(OffsetDateTime.now());
        return toView(e);
    }

    @Override
    @Transactional
    public EnrollmentView cancel(UUID curriculumId, UUID userId) {
        Enrollment e = repository.findByCurriculumIdAndUserId(curriculumId, userId)
                .orElseThrow(() -> new EnrollmentNotFoundException("수강 기록이 없습니다."));
        if (e.getStatus() != EnrollmentStatus.PENDING && e.getStatus() != EnrollmentStatus.ACTIVE) {
            throw new EnrollmentStateConflictException("취소할 수 있는 상태가 아닙니다.");
        }
        e.setStatus(EnrollmentStatus.CANCELLED);
        return toView(e);
    }

    @Override
    @Transactional
    public EnrollmentView revoke(UUID enrollmentId) {
        Enrollment e = require(enrollmentId);
        if (e.getStatus() != EnrollmentStatus.ACTIVE) {
            throw new EnrollmentStateConflictException("수강 중이 아니라 제적할 수 없습니다.");
        }
        e.setStatus(EnrollmentStatus.REVOKED);
        return toView(e);
    }

    @Override
    @Transactional(readOnly = true)
    public List<EnrollmentView> pendingFor(UUID curriculumId) {
        return repository.findByCurriculumIdAndStatusOrderByRequestedAtAsc(curriculumId, EnrollmentStatus.PENDING)
                .stream().map(EnrollmentService::toView).toList();
    }

    @Override
    @Transactional(readOnly = true)
    public boolean isActive(UUID curriculumId, UUID userId) {
        return repository.existsByCurriculumIdAndUserIdAndStatus(curriculumId, userId, EnrollmentStatus.ACTIVE);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<EnrollmentView> find(UUID curriculumId, UUID userId) {
        return repository.findByCurriculumIdAndUserId(curriculumId, userId).map(EnrollmentService::toView);
    }

    @Override
    @Transactional(readOnly = true)
    public Optional<EnrollmentView> findById(UUID enrollmentId) {
        return repository.findById(enrollmentId).map(EnrollmentService::toView);
    }

    @Override
    @Transactional(readOnly = true)
    public List<EnrollmentView> myEnrollments(UUID userId) {
        return repository.findByUserIdOrderByCreatedAtDesc(userId).stream().map(EnrollmentService::toView).toList();
    }

    @Override
    @Transactional(readOnly = true)
    public List<EnrollmentView> activeFor(UUID curriculumId) {
        return repository.findByCurriculumIdAndStatusOrderByRequestedAtAsc(curriculumId, EnrollmentStatus.ACTIVE)
                .stream().map(EnrollmentService::toView).toList();
    }

    private Enrollment require(UUID enrollmentId) {
        return repository.findById(enrollmentId)
                .orElseThrow(() -> new EnrollmentNotFoundException("수강 기록을 찾을 수 없습니다."));
    }

    private static EnrollmentView toView(Enrollment e) {
        return new EnrollmentView(e.getId(), e.getCurriculumId(), e.getUserId(), e.getStatus(),
                e.getRequestedAt(), e.getDecidedAt(), e.getEnrolledAt());
    }
}
