package com.liveclass.video.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;

/** 강사의 다시보기 게시 철회 사유. 본문 자체와 reason은 모두 선택이다. */
public record WithdrawReplayRequest(
        @Schema(description = "게시 철회 사유", example = "자막 교정 후 다시 공개 예정", maxLength = 500)
        @Size(max = 500) String reason
) {
}
