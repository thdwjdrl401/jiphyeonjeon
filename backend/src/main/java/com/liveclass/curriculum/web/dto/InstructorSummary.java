package com.liveclass.curriculum.web.dto;

import com.liveclass.curriculum.service.CatalogInstructor;
import io.swagger.v3.oas.annotations.media.Schema;

import java.util.List;

@Schema(description = "공개 가능한 담당 강사 요약")
public record InstructorSummary(

        String instructorId,
        String displayName,
        String bio,
        List<String> expertise
) {

    /** 서비스 결과를 응답 형태로 옮긴다. 강사 정보를 못 찾은 경우(null)는 그대로 null. */
    public static InstructorSummary from(CatalogInstructor instructor) {
        if (instructor == null) {
            return null;
        }
        return new InstructorSummary(
                instructor.instructorId().toString(),
                instructor.displayName(),
                instructor.bio(),
                instructor.expertise());
    }
}
