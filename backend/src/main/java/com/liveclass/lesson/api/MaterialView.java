package com.liveclass.lesson.api;

import java.util.UUID;

/**
 * 레슨에 연결된 자료 한 건(경계 DTO). 연결 응답과 레슨/커리큘럼 상세의 materials 채우기에 쓴다.
 * fileName·sizeBytes는 연결 시점 asset에서 가져와 담는다(materialId·assetId는 연결 레코드·에셋 식별자).
 * status는 MaterialStatus 이름 문자열이다(경계에서 enum 비노출).
 */
public record MaterialView(
        UUID materialId,
        UUID assetId,
        String fileName,
        long fileSize,
        String status,
        String embeddingStatus
) {
}
