package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

@Schema(description = "레슨 자료 연결 요청")
public record AttachMaterialRequest(

        @Schema(description = "연결할 자료 에셋(kind=MATERIAL, 업로드 완료) id")
        @NotNull
        UUID assetId
) {
}
