package com.liveclass.live.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

/**
 * 강조 판서 캡처 저장 요청(ADR-0074).
 *
 * <p><b>시각(sessionMs)을 받지 않는다.</b> 서버가 정한다 — 채팅과 같은 규칙이다. 클라이언트 시계를
 * 믿으면 다시보기 앵커가 영상과 어긋나고, 그 어긋남은 나중에 근거를 눌렀을 때만 드러난다.
 */
@Schema(description = "강조 판서 캡처 저장 요청")
public record AnnotationHighlightRequest(

        @Schema(description = "합성 크롭 이미지의 에셋 식별자(kind=ANNOTATION_SNAPSHOT, 업로드 완료 상태)")
        @NotNull
        UUID assetId,

        @Schema(description = "강사가 확인한 해석 텍스트. 없으면 생략한다.")
        @Size(max = 4000)
        String interpretedText
) {
}
