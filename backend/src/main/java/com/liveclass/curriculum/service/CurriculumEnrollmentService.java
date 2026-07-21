package com.liveclass.curriculum.service;

import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.CurriculumLifecycleStatus;
import com.liveclass.curriculum.domain.EnrollmentType;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.enrollment.api.EnrollmentDirectory;
import com.liveclass.enrollment.api.EnrollmentManagement;
import com.liveclass.enrollment.api.EnrollmentView;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;

/**
 * 수강 오케스트레이션. enrollment은 상태기계만 담당하므로, 커리큘럼 정책(발행·모집창·정책타입)과
 * 소유권 검증은 여기서 하고 enrollment.api로 위임한다(curriculum → enrollment.api, 단방향).
 */
@Service
public class CurriculumEnrollmentService {

    private final CurriculumRepository curriculumRepository;
    private final EnrollmentManagement enrollmentManagement;
    private final EnrollmentDirectory enrollmentDirectory;

    public CurriculumEnrollmentService(CurriculumRepository curriculumRepository,
                                       EnrollmentManagement enrollmentManagement,
                                       EnrollmentDirectory enrollmentDirectory) {
        this.curriculumRepository = curriculumRepository;
        this.enrollmentManagement = enrollmentManagement;
        this.enrollmentDirectory = enrollmentDirectory;
    }

    /** 학생 수강 신청. 발행·모집창·정책 검증 후 정책에 맞는 초기 상태로 생성. */
    @Transactional
    public EnrollmentView apply(UUID curriculumId, UUID studentId) {
        Curriculum c = curriculumRepository.findById(curriculumId)
                .orElseThrow(() -> new CurriculumNotFoundException("커리큘럼을 찾을 수 없습니다."));

        if (c.getLifecycleStatus() != CurriculumLifecycleStatus.PUBLISHED) {
            throw new CurriculumStateConflictException("발행된 커리큘럼만 수강 신청할 수 있습니다.");
        }
        if (c.getEnrollmentType() == EnrollmentType.INVITATION_ONLY) {
            throw new CurriculumStateConflictException("초대 전용 커리큘럼입니다.");
        }
        OffsetDateTime now = OffsetDateTime.now();
        if (c.getEnrollmentOpensAt() != null && now.isBefore(c.getEnrollmentOpensAt())) {
            throw new CurriculumStateConflictException("아직 모집 기간이 아닙니다.");
        }
        if (c.getEnrollmentClosesAt() != null && now.isAfter(c.getEnrollmentClosesAt())) {
            throw new CurriculumStateConflictException("모집이 마감되었습니다.");
        }

        boolean requiresApproval = c.getEnrollmentType() == EnrollmentType.APPROVAL_REQUIRED;
        return enrollmentManagement.apply(curriculumId, studentId, requiresApproval);
    }

    /** 학생 본인 신청/수강 취소. */
    @Transactional
    public EnrollmentView cancel(UUID curriculumId, UUID studentId) {
        return enrollmentManagement.cancel(curriculumId, studentId);
    }

    /** 강사 승인 대기 목록. 소유권 검증. */
    @Transactional(readOnly = true)
    public List<EnrollmentView> pending(UUID curriculumId, UUID instructorId) {
        requireOwned(curriculumId, instructorId);
        return enrollmentManagement.pendingFor(curriculumId);
    }

    /** 강사 승인. 소유권 + 그 커리큘럼 소속 검증. */
    @Transactional
    public EnrollmentView approve(UUID curriculumId, UUID enrollmentId, UUID instructorId) {
        requireEnrollmentInOwnedCurriculum(curriculumId, enrollmentId, instructorId);
        return enrollmentManagement.approve(enrollmentId);
    }

    /** 강사 거절. */
    @Transactional
    public EnrollmentView reject(UUID curriculumId, UUID enrollmentId, UUID instructorId) {
        requireEnrollmentInOwnedCurriculum(curriculumId, enrollmentId, instructorId);
        return enrollmentManagement.reject(enrollmentId);
    }

    /** 강사 수강 제적(강퇴). */
    @Transactional
    public EnrollmentView revoke(UUID curriculumId, UUID enrollmentId, UUID instructorId) {
        requireEnrollmentInOwnedCurriculum(curriculumId, enrollmentId, instructorId);
        return enrollmentManagement.revoke(enrollmentId);
    }

    private void requireEnrollmentInOwnedCurriculum(UUID curriculumId, UUID enrollmentId, UUID instructorId) {
        requireOwned(curriculumId, instructorId);
        EnrollmentView e = enrollmentDirectory.findById(enrollmentId)
                .orElseThrow(() -> new CurriculumNotFoundException("수강 기록을 찾을 수 없습니다."));
        if (!e.curriculumId().equals(curriculumId)) {
            // 다른 커리큘럼의 수강 기록을 이 경로로 조작하지 못하게.
            throw new CurriculumNotFoundException("이 커리큘럼의 수강 기록이 아닙니다.");
        }
    }

    private Curriculum requireOwned(UUID curriculumId, UUID instructorId) {
        Curriculum c = curriculumRepository.findById(curriculumId)
                .orElseThrow(() -> new CurriculumNotFoundException("커리큘럼을 찾을 수 없습니다."));
        if (!c.getInstructorId().equals(instructorId)) {
            throw new NotCurriculumOwnerException("본인 커리큘럼이 아닙니다.");
        }
        return c;
    }
}
