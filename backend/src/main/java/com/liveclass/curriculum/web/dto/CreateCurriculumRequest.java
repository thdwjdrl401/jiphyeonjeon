package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

import java.util.UUID;

@Schema(description = "커리큘럼 생성 요청")
public record CreateCurriculumRequest(

        @Schema(description = "제목", example = "실시간 Spring 입문", maxLength = 200)
        @NotBlank
        @Size(max = 200)
        String title,

        @Schema(description = "카드용 짧은 소개", example = "라이브로 배우는 Spring 기초", maxLength = 500)
        @Size(max = 500)
        String summary,

        @Schema(description = "상세 설명")
        String description,

        @Schema(description = "썸네일 에셋 id(선택). 미리 업로드 완료(UPLOADED)한 본인 THUMBNAIL 에셋이어야 한다.")
        UUID thumbnailAssetId
) {
}
