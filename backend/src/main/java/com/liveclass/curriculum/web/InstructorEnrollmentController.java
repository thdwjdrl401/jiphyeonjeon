package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CurriculumEnrollmentService;
import com.liveclass.curriculum.web.dto.EnrollmentResponse;
import com.liveclass.curriculum.web.dto.EnrollmentRosterResponse;
import com.liveclass.enrollment.api.EnrollmentStatus;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** 강사 수강 관리: 수강생 로스터·승인·거절·제적. /api/instructor/** 라 INSTRUCTOR 역할 필수(SecurityConfig). */
@Tag(name = "수강(강사)", description = "수강생 로스터·승인·거절·제적")
@RestController
public class InstructorEnrollmentController {

    private final CurriculumEnrollmentService service;

    public InstructorEnrollmentController(CurriculumEnrollmentService service) {
        this.service = service;
    }

    @Operation(summary = "수강생 로스터",
            description = "이 커리큘럼의 수강 신청·수강생 목록(신청자 이름·이메일 포함) 한 페이지와 상태별 건수(summary). "
                    + "status를 주면 그 상태만, 생략하면 전체. 학생 이름·이메일 검색(q)은 아직 지원하지 않는다"
                    + "(공개 범위·검색 대상 필드가 개인정보 정책과 함께 확정되면 도입 — CURRICULUM_MANAGEMENT §8.1).")
    @GetMapping("/api/instructor/curriculums/{curriculumId}/enrollments")
    public EnrollmentRosterResponse roster(
            @PathVariable UUID curriculumId,
            @RequestParam(required = false) EnrollmentStatus status,
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "20") int size,
            Authentication authentication) {
        UUID instructorId = UUID.fromString(authentication.getName());
        int pageSize = PageParams.size(size);
        return EnrollmentRosterResponse.from(
                service.roster(curriculumId, instructorId, status, PageParams.page(page, pageSize), pageSize));
    }

    @Operation(summary = "수강 승인", description = "PENDING → ACTIVE.")
    @PostMapping("/api/instructor/curriculums/{curriculumId}/enrollments/{enrollmentId}/approve")
    public EnrollmentResponse approve(@PathVariable UUID curriculumId, @PathVariable UUID enrollmentId,
                                      Authentication authentication) {
        UUID instructorId = UUID.fromString(authentication.getName());
        return EnrollmentResponse.from(service.approve(curriculumId, enrollmentId, instructorId));
    }

    @Operation(summary = "수강 거절", description = "PENDING → REJECTED.")
    @PostMapping("/api/instructor/curriculums/{curriculumId}/enrollments/{enrollmentId}/reject")
    public EnrollmentResponse reject(@PathVariable UUID curriculumId, @PathVariable UUID enrollmentId,
                                     Authentication authentication) {
        UUID instructorId = UUID.fromString(authentication.getName());
        return EnrollmentResponse.from(service.reject(curriculumId, enrollmentId, instructorId));
    }

    @Operation(summary = "수강 제적(강퇴)", description = "ACTIVE → REVOKED.")
    @PostMapping("/api/instructor/curriculums/{curriculumId}/enrollments/{enrollmentId}/revoke")
    public EnrollmentResponse revoke(@PathVariable UUID curriculumId, @PathVariable UUID enrollmentId,
                                     Authentication authentication) {
        UUID instructorId = UUID.fromString(authentication.getName());
        return EnrollmentResponse.from(service.revoke(curriculumId, enrollmentId, instructorId));
    }

}
