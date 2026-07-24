package com.liveclass.auth.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;

import java.util.List;

/**
 * 강사 공개 프로필 저장 요청.
 *
 * <p>상한을 두는 이유: 카탈로그 강사 소개에 그대로 노출되므로, 태그 수·길이가 무제한이면 화면이
 * 깨진다. bio는 null 허용(소개 없음), expertise는 null이면 빈 목록으로 다룬다.
 */
@Schema(description = "강사 공개 프로필 저장 요청")
public record UpdateInstructorProfileRequest(

        @Schema(description = "소개글(최대 1000자)", maxLength = 1000)
        @Size(max = 1000)
        String bio,

        @Schema(description = "전문분야 태그(최대 10개, 각 30자)")
        @Size(max = 10, message = "전문분야 태그는 최대 10개까지 등록할 수 있습니다.")
        List<@Size(max = 30, message = "전문분야 태그는 각 30자 이하여야 합니다.") String> expertise
) {
}
