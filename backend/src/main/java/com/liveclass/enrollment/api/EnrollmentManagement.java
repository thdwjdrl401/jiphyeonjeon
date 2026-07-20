package com.liveclass.enrollment.api;

import java.util.List;
import java.util.UUID;

/**
 * 수강 상태 변경 포트. enrollment은 커리큘럼 정책·소유권을 모르는 순수 상태기계다 —
 * 정책 검증(발행·모집창·정책타입)과 소유권 검증은 호출자(curriculum 오케스트레이터)가 하고,
 * 여기선 상태 전이 규칙만 강제한다. 이렇게 해서 enrollment → curriculum 의존(사이클)을 피한다.
 */
public interface EnrollmentManagement {

    /**
     * 수강 신청(멱등적 재신청 허용). 종료 상태(CANCELLED/REJECTED/REVOKED)면 같은 행을 되살린다.
     * 이미 PENDING/ACTIVE면 충돌.
     *
     * @param requiresApproval 강좌 정책이 승인제면 true → PENDING, 아니면 false → 즉시 ACTIVE
     */
    EnrollmentView apply(UUID curriculumId, UUID userId, boolean requiresApproval);

    /** 강사 승인: PENDING → ACTIVE. */
    EnrollmentView approve(UUID enrollmentId);

    /** 강사 거절: PENDING → REJECTED. */
    EnrollmentView reject(UUID enrollmentId);

    /** 학생 본인 취소: PENDING/ACTIVE → CANCELLED. */
    EnrollmentView cancel(UUID curriculumId, UUID userId);

    /** 강사 강퇴(수강 제적): ACTIVE → REVOKED. */
    EnrollmentView revoke(UUID enrollmentId);

    /** 강사용 승인 대기 목록(PENDING). */
    List<EnrollmentView> pendingFor(UUID curriculumId);
}
