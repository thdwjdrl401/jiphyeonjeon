package com.liveclass.enrollment.service;

import com.liveclass.enrollment.api.EnrollmentDirectory;
import com.liveclass.enrollment.api.EnrollmentManagement;
import com.liveclass.enrollment.api.EnrollmentNotFoundException;
import com.liveclass.enrollment.api.EnrollmentStateConflictException;
import com.liveclass.enrollment.api.EnrollmentView;
import com.liveclass.enrollment.domain.Enrollment;
import com.liveclass.enrollment.api.EnrollmentStatus;
import com.liveclass.enrollment.repository.EnrollmentRepository;
import com.liveclass.enrollment.repository.EnrollmentStatusCount;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

/**
 * 수강 상태기계. 커리큘럼 정책·소유권은 모른다(호출자 책임) — 여기선 전이 규칙만 강제한다.
 * 전이: 신청 → PENDING(승인제)/ACTIVE(즉시). 승인 PENDING→ACTIVE, 거절 PENDING→REJECTED,
 * 취소 PENDING/ACTIVE→CANCELLED, 강퇴 ACTIVE→REVOKED. 종료상태에서 재신청은 같은 행을 되살린다.
 */
@Service
public class EnrollmentService implements EnrollmentManagement, EnrollmentDirectory {

    /** 로스터 기본 정렬: 신청 순. requestedAt이 같아도 페이지 경계가 흔들리지 않게 id로 타이브레이크. */
    private static final Sort ROSTER_SORT = Sort.by(Sort.Order.asc("requestedAt"), Sort.Order.asc("id"));

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
        try {
            // 최초 동시 신청이 uq(curriculum_id, user_id)를 위반하면 여기서 DataIntegrityViolationException으로 올라온다.
            // curriculum 모듈의 핸들러는 이를 구조충돌(CURRICULUM_STRUCTURE_CONFLICT)로 오인하므로, 수강 도메인의
            // 상태충돌로 다시 던져 409 ENROLLMENT_STATE_CONFLICT로 내려간다.
            return toView(repository.saveAndFlush(e));
        } catch (DataIntegrityViolationException ex) {
            throw new EnrollmentStateConflictException("이미 수강 신청한 커리큘럼입니다.");
        }
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
    public Page<EnrollmentView> findPage(UUID curriculumId, EnrollmentStatus status, Pageable pageable) {
        // 정렬 필드는 enrollment 엔티티의 것이라 모듈 밖으로 새지 않게 여기서 채운다.
        Pageable sorted = pageable.getSort().isSorted()
                ? pageable
                : PageRequest.of(pageable.getPageNumber(), pageable.getPageSize(), ROSTER_SORT);
        Page<Enrollment> found = (status == null)
                ? repository.findByCurriculumId(curriculumId, sorted)
                : repository.findByCurriculumIdAndStatus(curriculumId, status, sorted);
        return found.map(EnrollmentService::toView);
    }

    @Override
    @Transactional(readOnly = true)
    public Map<EnrollmentStatus, Long> countsByStatus(UUID curriculumId) {
        Map<EnrollmentStatus, Long> counts = new EnumMap<>(EnrollmentStatus.class);
        for (EnrollmentStatus s : EnrollmentStatus.values()) {
            counts.put(s, 0L);
        }
        for (EnrollmentStatusCount row : repository.countByStatus(curriculumId)) {
            counts.put(row.status(), row.count());
        }
        return counts;
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
