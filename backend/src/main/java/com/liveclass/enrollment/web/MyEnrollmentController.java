package com.liveclass.enrollment.web;

import com.liveclass.enrollment.api.EnrollmentDirectory;
import com.liveclass.enrollment.web.dto.MyEnrollmentResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;
import java.util.UUID;

/** 내 수강 목록(학생). 정책·소유권과 무관한 단순 조회라 enrollment 모듈에 둔다. */
@Tag(name = "수강", description = "내 수강 목록")
@RestController
public class MyEnrollmentController {

    private final EnrollmentDirectory enrollmentDirectory;

    public MyEnrollmentController(EnrollmentDirectory enrollmentDirectory) {
        this.enrollmentDirectory = enrollmentDirectory;
    }

    @Operation(summary = "내 수강 목록", description = "내가 신청/수강한 커리큘럼 목록(최신순).")
    @GetMapping("/api/me/enrollments")
    public List<MyEnrollmentResponse> myEnrollments(Authentication authentication) {
        UUID userId = UUID.fromString(authentication.getName());
        return enrollmentDirectory.myEnrollments(userId).stream().map(MyEnrollmentResponse::from).toList();
    }
}
