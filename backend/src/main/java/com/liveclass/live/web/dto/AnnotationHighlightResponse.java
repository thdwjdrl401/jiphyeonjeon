package com.liveclass.live.web.dto;

import com.liveclass.live.domain.AnnotationHighlight;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * 강조 판서 캡처 응답(ADR-0074).
 *
 * <p>{@code imageUrl}은 표시용 presigned GET이라 만료된다. 목록을 오래 열어 두면 썸네일이 깨지므로
 * 화면은 다시 조회해서 갱신한다 — 영구 URL을 만들지 않는다(에셋 규약과 동일).
 */
@Schema(description = "강조 판서 캡처")
public record AnnotationHighlightResponse(

        @Schema(description = "캡처 식별자") UUID highlightId,
        @Schema(description = "이미지 에셋 식별자") UUID assetId,
        @Schema(description = "표시용 이미지 URL(presigned, 만료됨). 해석 불가 시 null") String imageUrl,
        @Schema(description = "라이브 시작 기준 경과 ms. 다시보기 앵커") long sessionMs,
        @Schema(description = "강사가 확인한 해석 텍스트. 없으면 null") String interpretedText,
        @Schema(description = "AI 색인 상태: PENDING/PROCESSING/READY/FAILED") String indexStatus,
        @Schema(description = "캡처 시각") OffsetDateTime createdAt
) {

    public static AnnotationHighlightResponse of(AnnotationHighlight highlight, String imageUrl) {
        return new AnnotationHighlightResponse(
                highlight.getId(),
                highlight.getAssetId(),
                imageUrl,
                highlight.getSessionMs() == null ? 0L : highlight.getSessionMs(),
                highlight.getInterpretedText(),
                highlight.getIndexStatus(),
                highlight.getCreatedAt());
    }
}
