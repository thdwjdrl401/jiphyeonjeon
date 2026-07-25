package com.liveclass.curriculum.web.dto;

import com.liveclass.lesson.api.MaterialView;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 커리큘럼·레슨에 붙은 강의 자료(PPTX). 레슨에 연결된 활성 자료를 그대로 옮긴다(ADR-0035).
 */
@Schema(description = "커리큘럼 강의 자료")
public record CurriculumMaterialResponse(
        String materialId,
        String fileName,
        long fileSize
) {

    public static CurriculumMaterialResponse from(MaterialView view) {
        return new CurriculumMaterialResponse(
                view.materialId().toString(),
                view.fileName(),
                view.fileSize());
    }
}
