package com.liveclass.auth.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotNull;

import java.util.UUID;

@Schema(description = "프로필 이미지 설정 요청")
public record ProfileImageRequest(

        @Schema(description = "업로드 완료(UPLOADED)한 본인 PROFILE_IMAGE 에셋 id")
        @NotNull
        UUID assetId
) {
}
