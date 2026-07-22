package com.liveclass.asset.web.dto;

import com.liveclass.asset.domain.AssetKind;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;

@Schema(description = "업로드 요청. presigned PUT URL을 발급받기 위한 메타데이터.")
public record UploadRequest(

        @Schema(description = "에셋 종류", example = "PROFILE_IMAGE")
        @NotNull
        AssetKind kind,

        @Schema(description = "원본 파일명", example = "avatar.png")
        @NotBlank
        String fileName,

        @Schema(description = "MIME 타입", example = "image/png")
        @NotBlank
        String contentType,

        @Schema(description = "바이트 크기(0 초과, 5MiB 이하)", example = "204800")
        @Positive
        long fileSize
) {
}
