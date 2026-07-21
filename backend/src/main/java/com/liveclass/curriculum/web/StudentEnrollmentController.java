package com.liveclass.curriculum.web;

import com.liveclass.curriculum.service.CurriculumEnrollmentService;
import com.liveclass.curriculum.web.dto.EnrollmentResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.http.HttpStatus;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

import java.util.UUID;

/** 학생 수강 신청·취소. 강사 계정은 SecurityConfig에서 STUDENT 역할로 차단(강사 수강 불가). */
@Tag(name = "수강", description = "학생 수강 신청·취소")
@RestController
public class StudentEnrollmentController {

    private final CurriculumEnrollmentService service;

    public StudentEnrollmentController(CurriculumEnrollmentService service) {
        this.service = service;
    }

    @Operation(summary = "수강 신청", description = "발행·모집창·정책 검증 후 신청. 승인제면 대기(PENDING), 즉시제면 바로 수강(ACTIVE).")
    @PostMapping("/api/curriculums/{curriculumId}/enrollments")
    @ResponseStatus(HttpStatus.CREATED)
    public EnrollmentResponse apply(@PathVariable UUID curriculumId, Authentication authentication) {
        UUID studentId = UUID.fromString(authentication.getName());
        return EnrollmentResponse.from(service.apply(curriculumId, studentId));
    }

    @Operation(summary = "수강 신청/수강 취소", description = "본인의 신청(대기) 또는 수강을 취소한다.")
    @DeleteMapping("/api/curriculums/{curriculumId}/enrollments/me")
    public EnrollmentResponse cancel(@PathVariable UUID curriculumId, Authentication authentication) {
        UUID studentId = UUID.fromString(authentication.getName());
        return EnrollmentResponse.from(service.cancel(curriculumId, studentId));
    }
}
