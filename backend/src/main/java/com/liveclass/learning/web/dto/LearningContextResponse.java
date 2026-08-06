package com.liveclass.learning.web.dto;

import com.liveclass.learning.domain.Bookmark;
import com.liveclass.learning.service.LearningService;
import io.swagger.v3.oas.annotations.media.Schema;

import java.time.OffsetDateTime;
import java.util.List;

/**
 * 레슨 학습 컨텍스트 응답. 진도가 아직 없으면 progress 는 null(첫 학습).
 */
@Schema(description = "레슨 학습 컨텍스트")
public record LearningContextResponse(

        String lessonId,
        Progress progress,
        List<Bookmark> bookmarks
) {

    @Schema(description = "내 진도")
    public record Progress(
            int progressPercent,
            long lastPositionMs,
            boolean completed,
            OffsetDateTime completedAt
    ) {
    }

    @Schema(description = "내 북마크")
    public record Bookmark(String bookmarkId, long sessionMs, OffsetDateTime createdAt) {
    }

    public static LearningContextResponse from(LearningService.LearningContext ctx) {
        Progress progress = ctx.progress() == null ? null : new Progress(
                ctx.progress().getProgressPercent() == null ? 0 : ctx.progress().getProgressPercent(),
                ctx.progress().getLastPositionMs() == null ? 0 : ctx.progress().getLastPositionMs(),
                ctx.progress().getCompletedAt() != null,
                ctx.progress().getCompletedAt());
        List<Bookmark> bookmarks = ctx.bookmarks().stream()
                .map(b -> new Bookmark(b.getId().toString(), b.getSessionMs(), b.getCreatedAt()))
                .toList();
        return new LearningContextResponse(ctx.lessonId().toString(), progress, bookmarks);
    }
}
