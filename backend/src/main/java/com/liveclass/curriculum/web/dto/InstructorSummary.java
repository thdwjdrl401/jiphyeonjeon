package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(description = "공개 가능한 담당 강사 요약")
public record InstructorSummary(

        String instructorId,
        String displayName,
        String bio,
        List<String> expertise
) {
}
