package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CurriculumEnrollmentService;
import com.liveclass.curriculum.web.dto.EnrollmentApplicantResponse;
import com.liveclass.curriculum.web.dto.EnrollmentResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/** 강사 수강 관리: 승인 대기 목록·승인·거절·제적. /api/instructor/** 라 INSTRUCTOR 역할 필수(SecurityConfig). */
@Tag(name = "수강(강사)", description = "승인 대기 목록·승인·거절·제적")
@RestController
public class InstructorEnrollmentController {

    private final CurriculumEnrollmentService service;

    public InstructorEnrollmentController(CurriculumEnrollmentService service) {
        this.service = service;
    }

    @Operation(summary = "승인 대기 목록", description = "이 커리큘럼의 승인 대기(PENDING) 수강 신청 목록(신청자 이름·이메일 포함).")
    @GetMapping("/api/instructor/curriculums/{curriculumId}/enrollments")
    public List<EnrollmentApplicantResponse> pending(@PathVariable UUID curriculumId, Authentication authentication) {
        UUID instructorId = UUID.fromString(authentication.getName());
        return service.pending(curriculumId, instructorId).stream().map(EnrollmentApplicantResponse::from).toList();
    }

    @Operation(summary = "수강생 로스터", description = "ACTIVE 수강생 목록(이름·이메일 포함).")
    @GetMapping("/api/instructor/curriculums/{curriculumId}/enrollments/active")
    public List<EnrollmentApplicantResponse> roster(@PathVariable UUID curriculumId, Authentication authentication) {
        UUID instructorId = UUID.fromString(authentication.getName());
        return service.roster(curriculumId, instructorId).stream().map(EnrollmentApplicantResponse::from).toList();
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
