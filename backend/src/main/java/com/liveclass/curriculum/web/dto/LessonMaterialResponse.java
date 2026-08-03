package com.liveclass.curriculum.web.dto;

import com.liveclass.lesson.api.MaterialView;
import io.swagger.v3.oas.annotations.media.Schema;

/**
 * 레슨 자료 연결 응답. 연결된 레코드 식별자·에셋 식별자·원본 파일명·상태를 돌려준다(계약 camelCase).
 * fileName은 asset에서 옮긴 원본 파일명, status는 MaterialStatus 이름(ACTIVE 등)이다.
 */
@Schema(description = "레슨 자료 연결 결과")
public record LessonMaterialResponse(
        String materialId,
        String assetId,
        String fileName,
        String status,
        String embeddingStatus,
        String keyTermStatus
) {

    public static LessonMaterialResponse from(MaterialView view) {
        return new LessonMaterialResponse(
                view.materialId().toString(),
                view.assetId().toString(),
                view.fileName(),
                view.status(),
                view.embeddingStatus(),
                view.keyTermStatus());
    }
}
