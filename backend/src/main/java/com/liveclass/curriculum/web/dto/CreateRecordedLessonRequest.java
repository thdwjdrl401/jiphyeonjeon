package com.liveclass.curriculum.web.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

import java.util.UUID;

public record CreateRecordedLessonRequest(
        @NotNull UUID clientRequestId,
        @NotBlank @Size(max = 200) String title,
        @Size(max = 5000) String description
) {
}
