package com.liveclass.curriculum.web.dto;

import jakarta.validation.constraints.NotNull;

import java.util.UUID;

public record CompleteRecordedVideoRequest(@NotNull UUID assetId) {
}
