package com.liveclass.curriculum.web.dto;

import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Size;

import java.time.OffsetDateTime;
import java.util.UUID;

/**
 * PATCH 부분 수정 — 넘어온 필드만 바꾼다. null은 "변경 안 함"으로 다룬다(전부 선택).
 * 기간(startsAt/endsAt) 검증 규칙은 미확정(FE §10-1 협의)이라 골격에선 값만 반영한다.
 */
@Schema(description = "커리큘럼 기본 정보 수정 요청 (부분)")
public record UpdateCurriculumRequest(

        @Schema(description = "제목", maxLength = 200)
        @Size(max = 200)
        String title,

        @Schema(description = "카드용 짧은 소개", maxLength = 500)
        @Size(max = 500)
        String summary,

        @Schema(description = "상세 설명")
        String description,

        @Schema(description = "진행 시작 시각", example = "2026-08-01T10:00:00+09:00")
        OffsetDateTime startsAt,

        @Schema(description = "진행 종료 시각", example = "2026-10-15T22:00:00+09:00")
        OffsetDateTime endsAt,

        @Schema(description = "썸네일 에셋 id(선택). 미리 업로드 완료(UPLOADED)한 본인 THUMBNAIL 에셋이어야 한다.")
        UUID thumbnailAssetId
) {
}
