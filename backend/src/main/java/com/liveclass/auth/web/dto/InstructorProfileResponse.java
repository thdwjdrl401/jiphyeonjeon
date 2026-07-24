package com.liveclass.auth.web.dto;

import com.liveclass.auth.service.InstructorProfileView;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(description = "강사 공개 프로필")
public record InstructorProfileResponse(
        @Schema(description = "소개글. 아직 저장한 적 없으면 null.")
        String bio,
        @Schema(description = "전문분야 태그. 없으면 빈 목록.")
        List<String> expertise
) {
    public static InstructorProfileResponse from(InstructorProfileView view) {
        return new InstructorProfileResponse(view.bio(), view.expertise());
    }
}
