package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 커리큘럼에 붙은 강의 자료(PPTX).
 * 자료를 커리큘럼·레슨에 연결하는 API가 아직 없어 현재는 목록이 항상 비어 있다 —
 * 형태만 먼저 계약에 고정해 FE가 임의 형태를 가정하지 않게 한다.
 */
@Schema(description = "커리큘럼 강의 자료")
public record CurriculumMaterialResponse(
        String materialId,
        String fileName,
        long fileSize
) {
}
