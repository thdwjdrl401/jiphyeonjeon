package com.liveclass.curriculum.service;

import com.liveclass.curriculum.domain.Curriculum;
import com.liveclass.curriculum.domain.CurriculumLifecycleStatus;
import com.liveclass.curriculum.domain.EnrollmentType;
import com.liveclass.auth.api.UserContact;
import com.liveclass.auth.api.UserDirectory;
import com.liveclass.curriculum.repository.CurriculumRepository;
import com.liveclass.enrollment.api.EnrollmentCanceledEvent;
import com.liveclass.enrollment.api.EnrollmentDecidedEvent;
import com.liveclass.enrollment.api.EnrollmentDirectory;
import com.liveclass.enrollment.api.EnrollmentManagement;
import com.liveclass.enrollment.api.EnrollmentRequestedEvent;
import com.liveclass.enrollment.api.EnrollmentStatus;
import com.liveclass.enrollment.api.EnrollmentView;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.OffsetDateTime;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;

/**
 * 수강 오케스트레이션. enrollment은 상태기계만 담당하므로, 커리큘럼 정책(발행·모집창·정책타입)과
 * 소유권 검증은 여기서 하고 enrollment.api로 위임한다(curriculum → enrollment.api, 단방향).
 */
@Service
public class CurriculumEnrollmentService {

    private final CurriculumRepository curriculumRepository;
    private final EnrollmentManagement enrollmentManagement;
    private final EnrollmentDirectory enrollmentDirectory;
    private final UserDirectory userDirectory;
    private final ApplicationEventPublisher eventPublisher;

    public CurriculumEnrollmentService(CurriculumRepository curriculumRepository,
                                       EnrollmentManagement enrollmentManagement,
                                       EnrollmentDirectory enrollmentDirectory,
                                       UserDirectory userDirectory,
                                       ApplicationEventPublisher eventPublisher) {
        this.curriculumRepository = curriculumRepository;
        this.enrollmentManagement = enrollmentManagement;
        this.enrollmentDirectory = enrollmentDirectory;
        this.userDirectory = userDirectory;
        this.eventPublisher = eventPublisher;
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
        EnrollmentView applied = enrollmentManagement.apply(curriculumId, studentId, requiresApproval);

        /*
         * 사건은 **승인 대기로 들어갔을 때만** 낸다. 즉시 수강은 강사가 처리할 일이 없는데,
         * 그런데도 "신청이 들어왔습니다"를 보내면 처리 대기 목록이 영영 줄지 않는다.
         *
         * 여기서 알림을 직접 만들지 않는 이유는 ADR-0073 §1이다 — 수강 로직이 알림의 존재를
         * 알아야 할 이유가 없고, 알게 되는 순간 네 모듈이 알림에 의존한다.
         */
        if (applied.status() == EnrollmentStatus.PENDING) {
            eventPublisher.publishEvent(new EnrollmentRequestedEvent(
                    applied.id(), curriculumId, c.getTitle(),
                    c.getInstructorId(), studentId, applied.requestedAt()));
        }
        return applied;
    }

    /**
     * 학생 본인 신청/수강 취소.
     *
     * <p>사건을 내는 이유는 알림을 <b>만들기</b> 위해서가 아니라 <b>정리</b>하기 위해서다. 강사에게
     * 나가 있던 "수강 신청이 들어왔습니다"는 이제 승인할 수도 거절할 수도 없는데, 그대로 두면
     * 처리 대기 목록에 영영 남는다(EnrollmentCanceledEvent).
     */
    @Transactional
    public EnrollmentView cancel(UUID curriculumId, UUID studentId) {
        EnrollmentView canceled = enrollmentManagement.cancel(curriculumId, studentId);
        eventPublisher.publishEvent(new EnrollmentCanceledEvent(
                canceled.id(), curriculumId, studentId, OffsetDateTime.now()));
        return canceled;
    }

    /**
     * 강사용 수강생 로스터 한 페이지 + 커리큘럼 전체의 상태별 건수(ENROLLEE-01). 소유권 검증.
     * summary는 집계 쿼리로 세고(행 미적재), 항목의 이름·이메일은 현재 페이지만 배치 보강한다.
     *
     * @param status null이면 상태 필터 없이 전체
     */
    @Transactional(readOnly = true)
    public EnrollmentRoster roster(UUID curriculumId, UUID instructorId, EnrollmentStatus status,
                                   int page, int size) {
        requireOwned(curriculumId, instructorId);
        Page<EnrollmentApplicant> items =
                enrich(enrollmentDirectory.findPage(curriculumId, status, PageRequest.of(page, size)));
        return new EnrollmentRoster(items, enrollmentDirectory.countsByStatus(curriculumId));
    }

    /** 현재 페이지의 수강 기록만 사용자 PII로 보강한다(배치 조회 1회, N+1 없음). 페이지 순서 보존. */
    private Page<EnrollmentApplicant> enrich(Page<EnrollmentView> views) {
        List<UUID> userIds = views.getContent().stream().map(EnrollmentView::userId).distinct().toList();
        Map<UUID, UserContact> byId = userDirectory.findContacts(userIds).stream()
                .collect(Collectors.toMap(UserContact::userId, Function.identity()));
        return views.map(v -> new EnrollmentApplicant(v, byId.get(v.userId())));
    }

    /** 강사 승인. 소유권 + 그 커리큘럼 소속 검증. */
    @Transactional
    public EnrollmentView approve(UUID curriculumId, UUID enrollmentId, UUID instructorId) {
        Curriculum c = requireEnrollmentInOwnedCurriculum(curriculumId, enrollmentId, instructorId);
        EnrollmentView decided = enrollmentManagement.approve(enrollmentId);
        publishDecided(c, decided, true);
        return decided;
    }

    /** 강사 거절. */
    @Transactional
    public EnrollmentView reject(UUID curriculumId, UUID enrollmentId, UUID instructorId) {
        Curriculum c = requireEnrollmentInOwnedCurriculum(curriculumId, enrollmentId, instructorId);
        EnrollmentView decided = enrollmentManagement.reject(enrollmentId);
        publishDecided(c, decided, false);
        return decided;
    }

    private void publishDecided(Curriculum c, EnrollmentView decided, boolean approved) {
        eventPublisher.publishEvent(new EnrollmentDecidedEvent(
                decided.id(), c.getId(), c.getTitle(),
                c.getInstructorId(), decided.userId(), approved, decided.decidedAt()));
    }

    /** 강사 수강 제적(강퇴). */
    @Transactional
    public EnrollmentView revoke(UUID curriculumId, UUID enrollmentId, UUID instructorId) {
        requireEnrollmentInOwnedCurriculum(curriculumId, enrollmentId, instructorId);
        return enrollmentManagement.revoke(enrollmentId);
    }

    private Curriculum requireEnrollmentInOwnedCurriculum(UUID curriculumId, UUID enrollmentId, UUID instructorId) {
        Curriculum c = requireOwned(curriculumId, instructorId);
        EnrollmentView e = enrollmentDirectory.findById(enrollmentId)
                .orElseThrow(() -> new CurriculumNotFoundException("수강 기록을 찾을 수 없습니다."));
        if (!e.curriculumId().equals(curriculumId)) {
            // 다른 커리큘럼의 수강 기록을 이 경로로 조작하지 못하게.
            throw new CurriculumNotFoundException("이 커리큘럼의 수강 기록이 아닙니다.");
        }
        return c;
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
