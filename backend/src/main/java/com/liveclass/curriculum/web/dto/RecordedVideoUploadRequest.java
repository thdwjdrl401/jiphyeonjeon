package com.liveclass.curriculum.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public record RecordedVideoUploadRequest(
        @NotBlank @Size(max = 500) String fileName,
        @NotBlank @Size(max = 255) String contentType,
        @Positive long fileSize
) {
}
